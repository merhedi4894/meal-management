'use client';
import { useState, useEffect, useCallback, useRef, Component, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Search, Loader2, User, Phone, CalendarDays, Receipt, ReceiptText, Wallet, UtensilsCrossed,
  Pencil, Trash2, Plus, Database, Settings, AlertTriangle, ChevronLeft, ChevronRight,
  Lock, Unlock, CheckCircle, Download, LogOut, UserPlus, Upload, KeyRound,
  ChevronDown, ChevronUp, Wifi, Users, RefreshCw, Eye, EyeOff, ArrowRight, ShoppingCart, Flame, X, Save, ShoppingBag, BarChart3

} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const MONTHS = [
  'সকল মাস', 'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে',
  'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
];
const MONTHS_NO_ALL = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে',
  'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
];
// Bangladesh timezone (Asia/Dhaka) ব্যবহার করে মাস/বছর কম্পিউট — hydration mismatch এড়াতে
const getBnMonth = () => {
  const m = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', month: 'numeric' });
  const monthNum = parseInt(formatter.format(new Date())) - 1;
  return m[monthNum];
};
const getBdYear = () => {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric' });
  return formatter.format(new Date());
};
const currentMonth = getBnMonth();
const currentYear = getBdYear();
const ADMIN_PASSWORD = 'admin123';
// sessionStorage থেকে admin password পাওয়ার হেল্পার (serverless তে token কাজ না করলে fallback)
function getAdminPassword(): string {
  return sessionStorage.getItem('adminPwd') || '';
}
const ADMIN_EMAIL = 'mehedi24.info@gmail.com';

// Admin auth token পাওয়ার হেল্পার
function getAdminToken(): string | null {
  return sessionStorage.getItem('adminToken');
}

// entryDate বাংলাদেশ সময়ে সেভ থাকে (ISO format, Z ছাড়া)
// JavaScript ঠিকমতো পার্স করতে +06:00 যোগ করতে হবে
function parseBDDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const s = String(dateStr).trim();
  if (s.includes('Z') || s.includes('+') || s.includes('-05:00') || s.includes('-06:00')) return new Date(s);
  return new Date(s + '+06:00');
}

// মোবাইল নম্বরে লিডিং জিরো যোগ (বাংলাদেশি নম্বর: ১১ ডিজিট → ০ যোগ করে ১২ ডিজিট)
function formatMobile(mobile: string): string {
  if (!mobile) return '';
  const digits = mobile.replace(/\D/g, '');
  if (digits.length === 11 && !digits.startsWith('0')) return '0' + digits;
  return mobile;
}

// ===== Global Event System =====
// সকল সেকশনে অটো রিফ্রেশ — যেকোনো মিল ডাটা পরিবর্তন হলে সব জায়গায় আপডেট
function dispatchMealDataChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('meal-data-changed'));
  }
}

// বাংলা ডিজিট থেকে ইংরেজি ডিজিটে রূপান্তর
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

// ==================== TYPES ====================
interface PriceSetting {
  id: string; month: string; year: string;
  breakfastPrice: number; lunchPrice: number; morningSpecial: number; lunchSpecial: number;
}
interface MealEntry {
  id: string; entryDate: string; month: string; year: string;
  officeId: string; name: string; mobile: string;
  breakfastCount: number; lunchCount: number; morningSpecial: number; lunchSpecial: number;
  totalBill: number; deposit: number; depositDate: string;
  prevBalance: number; curBalance: number;
}
interface SummaryData {
  total_mB: number; total_lM: number; total_mS: number; total_lS: number;
  total_bill: number; total_deposit: number; entryCount: number;
}
interface MonthlyBreakdown {
  month: string; year: string; totalBill: number; totalDeposit: number;
  netBalance: number; endBalance: number;
}
interface LookupUser {
  officeId: string; name: string; mobile: string; designation?: string;
}
interface BalanceEmployee {
  officeId: string; name: string; mobile: string; curBalance: number; designation?: string;
}

// ==================== ADMIN PANEL ====================
function AdminPanel({ onLogout, onMealOrderChange }: { onLogout: () => void; onMealOrderChange?: () => void }) {
  const { toast } = useToast();
  const [activePanel, setActivePanel] = useState('adminMealOrder');
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [settings, setSettings] = useState<PriceSetting[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  // Admin search filters
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState(currentYear);
  const [filterQuery, setFilterQuery] = useState('');
  // Edit entry dialog
  const [editEntry, setEditEntry] = useState<MealEntry | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [editLoading, setEditLoading] = useState(false);
  const [editLookupLoading, setEditLookupLoading] = useState(false);
  // Edit setting dialog
  const [editSetting, setEditSetting] = useState<PriceSetting | null>(null);
  const [settingForm, setSettingForm] = useState<Record<string, string>>({});
  // New setting dialog
  const [newSettingOpen, setNewSettingOpen] = useState(false);
  const [newSettingForm, setNewSettingForm] = useState<Record<string, string>>({ month: currentMonth, year: currentYear });

  // ===== CSV ডাউনলোড state =====
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvMonth, setCsvMonth] = useState('');
  const [csvYear, setCsvYear] = useState(currentYear);
  // ===== সদস্য ইমপোর্ট (Google Sheets থেকে অফিস আইডি, নাম, পদবী, মোবাইল) =====
  const [memberImportOpen, setMemberImportOpen] = useState(false);
  const [memberImportUrl, setMemberImportUrl] = useState('');
  const [memberImportLoading, setMemberImportLoading] = useState(false);
  const [memberImportSaving, setMemberImportSaving] = useState(false);
  const [memberImportPreview, setMemberImportPreview] = useState<any>(null);
  const [memberImportResult, setMemberImportResult] = useState<any>(null);
  const [memberImportSheets, setMemberImportSheets] = useState<Array<{ name: string; gid: string }>>([]);
  const [memberImportSelectedSheet, setMemberImportSelectedSheet] = useState('');
  const [memberImportStep, setMemberImportStep] = useState<'url' | 'select' | 'preview' | 'result'>('url');
  const [memberColumnMap, setMemberColumnMap] = useState<Record<string, string>>({});
  // ===== ডাটাবেজ ডিলিট state =====
  const [deleteDbOpen, setDeleteDbOpen] = useState(false);
  const [deleteTab, setDeleteTab] = useState<'edit' | 'add' | 'search' | 'year' | 'all'>('edit');
  // ===== All Delete state =====
  const [allDeletePasswordStep, setAllDeletePasswordStep] = useState(false);
  const [allDeletePassword, setAllDeletePassword] = useState('');
  const [allDeleteShowPwd, setAllDeleteShowPwd] = useState(false);
  const [allDeletePasswordError, setAllDeletePasswordError] = useState('');
  const [allDeleteVerified, setAllDeleteVerified] = useState(false);
  const [allDeleteLoading, setAllDeleteLoading] = useState(false);

  // Tab 1: ব্যক্তিগত তথ্য Edit/Del
  const [delSearchQuery, setDelSearchQuery] = useState('');
  const [delSearchMonth, setDelSearchMonth] = useState('');
  const [delSearchYear, setDelSearchYear] = useState(currentYear);
  const [delSearchResults, setDelSearchResults] = useState<MealEntry[]>([]);
  const [delSearchLoading, setDelSearchLoading] = useState(false);
  const [delSearchTotal, setDelSearchTotal] = useState(0);
  const [delSearchPage, setDelSearchPage] = useState(1);
  const [delSearchTotalPages, setDelSearchTotalPages] = useState(1);
  const [delSearchHasSearched, setDelSearchHasSearched] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [delEditForm, setDelEditForm] = useState<Record<string, string>>({});
  const [delEditLoading, setDelEditLoading] = useState(false);
  const [delSuggestions, setDelSuggestions] = useState<LookupUser[]>([]);
  const [delSuggestOpen, setDelSuggestOpen] = useState(false);
  const [delSelectedPerson, setDelSelectedPerson] = useState<LookupUser | null>(null);

  // Tab 2: বছরভিত্তিক ডিলিট
  const [delYearQuery, setDelYearQuery] = useState('');
  const [delYearYear, setDelYearYear] = useState(currentYear);
  const [delYearPreview, setDelYearPreview] = useState<{totalEntries: number; officeIds: Array<{officeId: string; name: string; designation: string; mobile: string; entryCount: number}>; willZeroOutCount: number; willDeleteCount: number} | null>(null);
  const [delYearLoading, setDelYearLoading] = useState(false);
  const [delYearPreviewLoading, setDelYearPreviewLoading] = useState(false);
  const [delYearDeleteLoading, setDelYearDeleteLoading] = useState(false);
  const [delYearPasswordStep, setDelYearPasswordStep] = useState(false);
  const [delYearPassword, setDelYearPassword] = useState('');
  const [delYearShowPwd, setDelYearShowPwd] = useState(false);
  const [delYearPasswordError, setDelYearPasswordError] = useState('');
  const [delYearSuggestions, setDelYearSuggestions] = useState<LookupUser[]>([]);
  const [delYearSuggestOpen, setDelYearSuggestOpen] = useState(false);
  // ===== এডিট সেকশন সাজেশন state =====
  const [editSuggestions, setEditSuggestions] = useState<LookupUser[]>([]);
  const [editSuggestOpen, setEditSuggestOpen] = useState(false);
  const [editLookupPreview, setEditLookupPreview] = useState<LookupUser | null>(null);
  const [editLookupPreviewLoading, setEditLookupPreviewLoading] = useState(false);
  // ===== এডিট ফর্ম ফিল্ড সাজেশন state =====
  const [editFormSuggestions, setEditFormSuggestions] = useState<LookupUser[]>([]);
  const [editFormSuggestOpen, setEditFormSuggestOpen] = useState(false);
  const [editFormSuggestField, setEditFormSuggestField] = useState<string>('');

  // ===== কনফার্মেশন ডায়ালগ state =====
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; onConfirm: () => void }>({ open: false, message: '', onConfirm: () => {} });
  const [syncMobileLoading, setSyncMobileLoading] = useState(false);

  // ===== মিল এন্ট্রি state =====
  const [mealForm, setMealForm] = useState<Record<string, string>>(() => {
    // Default entryDate to current BD date
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const bdMs = utcMs + 6 * 60 * 60000;
    const bd = new Date(bdMs);
    const dd = String(bd.getDate()).padStart(2, '0');
    const mm = String(bd.getMonth() + 1).padStart(2, '0');
    const yyyy = bd.getFullYear();
    return { month: currentMonth, year: currentYear, entryDate: `${yyyy}-${mm}-${dd}` };
  });
  const [mealLookupResult, setMealLookupResult] = useState<LookupUser | null>(null);
  const [mealLookupLoading, setMealLookupLoading] = useState(false);
  const [mealSaving, setMealSaving] = useState(false);
  const [mealSuggestions, setMealSuggestions] = useState<LookupUser[]>([]);
  const [mealSuggestOpen, setMealSuggestOpen] = useState(false);
  const [mealSuggestField, setMealSuggestField] = useState<string>('');

  // ===== Admin মিল অর্ডার state =====
  const [amoQuery, setAmoQuery] = useState('');
  const [amoSuggestions, setAmoSuggestions] = useState<Array<{officeId: string; name: string; mobile: string; designation: string}>>([]);
  const [amoNotFound, setAmoNotFound] = useState(false);
  const [amoSuggestOpen, setAmoSuggestOpen] = useState(false);
  const [amoSelectedUser, setAmoSelectedUser] = useState<{officeId: string; name: string; mobile: string; designation: string} | null>(null);
  const [amoOrderDate, setAmoOrderDate] = useState('');
  const [amoBreakfast, setAmoBreakfast] = useState(0);
  const [amoLunch, setAmoLunch] = useState(0);
  const [amoMorningSpecial, setAmoMorningSpecial] = useState(0);
  const [amoLunchSpecial, setAmoLunchSpecial] = useState(0);
  const [amoSaving, setAmoSaving] = useState(false);
  const [amoSettling, setAmoSettling] = useState(false);
  const [amoOrders, setAmoOrders] = useState<any[]>([]);
  const [amoSuggestTimer, setAmoSuggestTimer] = useState<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Admin order inline edit
  const [amoEditOrder, setAmoEditOrder] = useState<any>(null); // currently editing order
  const [amoEditSaving, setAmoEditSaving] = useState(false);
  const [amoListOpen, setAmoListOpen] = useState(false); // dropdown open/close

  // ===== টাকা জমা এন্ট্রি state =====
  const [depositForm, setDepositForm] = useState<Record<string, string>>({ month: currentMonth, year: currentYear });
  const [depositLookupResult, setDepositLookupResult] = useState<LookupUser | null>(null);
  const [depositLookupLoading, setDepositLookupLoading] = useState(false);
  const [depositSaving, setDepositSaving] = useState(false);
  const [depositInfo, setDepositInfo] = useState<any>(null);
  const [depositInfoLoading, setDepositInfoLoading] = useState(false);
  const [depositSuggestions, setDepositSuggestions] = useState<LookupUser[]>([]);
  const [depositSuggestOpen, setDepositSuggestOpen] = useState(false);
  const [depositSuggestField, setDepositSuggestField] = useState<string>('');

  // ===== বকেয়া / অগ্রিম টাকা state =====
  const [balanceEmployees, setBalanceEmployees] = useState<BalanceEmployee[]>([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceFilter, setBalanceFilter] = useState('');
  const [balanceLoaded, setBalanceLoaded] = useState(false);

  // ===== সদস্য যোগ state =====
  const [memberForm, setMemberForm] = useState<Record<string, string>>({});
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberLookupResult, setMemberLookupResult] = useState<LookupUser | null>(null);
  const [memberLookupLoading, setMemberLookupLoading] = useState(false);
  const [memberSuggestions, setMemberSuggestions] = useState<LookupUser[]>([]);
  const [memberSuggestOpen, setMemberSuggestOpen] = useState(false);
  const [memberSuggestField, setMemberSuggestField] = useState<string>('');

  // ===== বাজার খরচ state =====
  const [marketExpenseForm, setMarketExpenseForm] = useState<Record<string, string>>({
    expenseDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }),
  });
  const [marketExpenseSaving, setMarketExpenseSaving] = useState(false);
  const [marketExpenseSearchMonth, setMarketExpenseSearchMonth] = useState('');
  const [marketExpenseSearchYear, setMarketExpenseSearchYear] = useState(currentYear);
  const [marketExpenseResults, setMarketExpenseResults] = useState<Array<any>>([]);
  const [marketExpenseTotal, setMarketExpenseTotal] = useState(0);
  const [marketExpenseLoading, setMarketExpenseLoading] = useState(false);
  const [marketExpenseEditId, setMarketExpenseEditId] = useState<string | null>(null);
  const [marketExpenseEditForm, setMarketExpenseEditForm] = useState<Record<string, string>>({});
  const [marketExpenseEditSaving, setMarketExpenseEditSaving] = useState(false);
  const [marketExpenseDetailsOpen, setMarketExpenseDetailsOpen] = useState(false);

  // ===== মাস অনুযায়ী মোট মিল state =====
  const [monthlyMealMonth, setMonthlyMealMonth] = useState('');
  const [monthlyMealYear, setMonthlyMealYear] = useState(currentYear);
  const [monthlyMealSummary, setMonthlyMealSummary] = useState<any>(null);
  const [monthlyMealLoading, setMonthlyMealLoading] = useState(false);
  const [monthlyMealExpandedRows, setMonthlyMealExpandedRows] = useState<Set<number>>(new Set());
  const [monthlyMealDetailsOpen, setMonthlyMealDetailsOpen] = useState(false);

  // ===== রান্না (Special Meal) state =====
  const [rannaDate, setRannaDate] = useState('');
  const [rannaMorningSpecial, setRannaMorningSpecial] = useState(false);
  const [rannaLunchSpecial, setRannaLunchSpecial] = useState(false);
  const [rannaSaving, setRannaSaving] = useState(false);
  const [rannaCookingDate, setRannaCookingDate] = useState('');
  const [rannaCookingData, setRannaCookingData] = useState<any>(null);
  const [rannaCookingLoading, setRannaCookingLoading] = useState(false);
  const [rannaCookingShowDetails, setRannaCookingShowDetails] = useState(false);
  const [rannaExpandedRows, setRannaExpandedRows] = useState<Set<number>>(new Set());
  const [rannaSettings, setRannaSettings] = useState<any[]>([]);
  const [rannaSearch, setRannaSearch] = useState('');
  const [rannaSearchSuggestions, setRannaSearchSuggestions] = useState<{ officeId: string; name: string; designation?: string; mobile?: string }[]>([]);
  const [rannaSearchDropdownOpen, setRannaSearchDropdownOpen] = useState(false);
  const rannaSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRannaSearchChange = (val: string) => {
    setRannaSearch(val);
    setRannaSearchSuggestions([]);
    setRannaSearchDropdownOpen(false);
    if (!val || val.length < 2) return;
    if (rannaSearchTimer.current) clearTimeout(rannaSearchTimer.current);
    rannaSearchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/entries?action=lookup&query=${encodeURIComponent(bnToEn(val.trim()))}`);
        const data = await res.json();
        if (data.success && data.users && data.users.length > 0) {
          setRannaSearchSuggestions(data.users.map((u: any) => ({ officeId: u.officeId, name: u.name || '', designation: u.designation || '', mobile: u.mobile || '' })));
          setRannaSearchDropdownOpen(true);
        }
      } catch { /* silent */ }
    }, 400);
  };

  const handleRannaSearchSelect = (user: any) => {
    setRannaSearch(user.name || user.officeId);
    setRannaSearchSuggestions([]);
    setRannaSearchDropdownOpen(false);
  };
  // এডমিন ইন্ডিভিজুয়াল অর্ডার এডিট
  const [rannaEditOrder, setRannaEditOrder] = useState<any>(null);
  const [rannaEditSaving, setRannaEditSaving] = useState(false);

  // ===== Fetch functions =====
  const fetchEntries = useCallback(async (p = 1, fMonth = filterMonth, fYear = filterYear, fQuery = filterQuery) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: '25' });
      if (fMonth) params.set('adminMonth', fMonth);
      if (fYear) params.set('adminYear', fYear);
      if (fQuery) params.set('adminQuery', fQuery);
      const res = await fetch(`/api/entries?${params}`);
      const data = await res.json();
      if (data.success) {
        setEntries(data.entries);
        setPage(data.page);
        setTotalPages(data.totalPages);
      }
    } catch { toast({ title: 'এরর', description: 'ডাটা লোড হয়নি', variant: 'destructive' }); }
    finally { setLoading(false); }
  }, [toast, filterMonth, filterYear, filterQuery]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.success) setSettings(data.settings);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  // Auto merge duplicates & recalculate on admin load (ensures data consistency)
  useEffect(() => {
    const cleanup = async () => {
      try {
        const res = await fetch('/api/entries?action=merge_duplicates');
        const data = await res.json();
        if (data.success && data.mergedCount > 0) {
          console.log(`Auto-merged ${data.mergedCount} duplicate entries`);
        }
        // Also run full recalculate
        const res2 = await fetch('/api/entries?action=recalculate_all');
        const data2 = await res2.json();
        if (data2.success) {
          console.log(`Recalculated balances: ${data2.message}`);
        }
      } catch { /* silent — admin page still works */ }
    };
    cleanup();
  }, []);

  // ===== Global auto-refresh: যেকোনো ডাটা পরিবর্তন হলে সব সেকশন রিফ্রেশ =====
  useEffect(() => {
    const handler = () => {
      // Admin মিল অর্ডার রিফ্রেশ
      if (amoOrderDate) fetchAmoOrders();
      // মোট মিল (মাসিক সামারি) রিফ্রেশ
      if (monthlyMealMonth && monthlyMealYear) handleMonthlyMealSearch();
      // মিল এবং জমা টাকা রিফ্রেশ
      if (delSearchHasSearched && delSearchQuery) handleDelSearch(delSearchPage);
      // ব্যালেন্স রিফ্রেশ (ফোর্স রিলোড)
      setBalanceLoaded(false);
      // বাজার খরচ রিফ্রেশ
      if (marketExpenseSearchMonth || marketExpenseResults.length > 0) {
        const meUrl = `/api/market-expense?action=search&month=${marketExpenseSearchMonth}&year=${marketExpenseSearchYear}`;
        fetch(meUrl).then(r => r.json()).then(d => { if (d.success) { setMarketExpenseResults(d.expenses || []); setMarketExpenseTotal(d.total || 0); } }).catch(() => {});
      }
      // স্পেশাল মিল (রান্না) রিফ্রেশ
      if (rannaCookingDate) fetchRannaCookingView(rannaCookingDate);
      fetchRannaSettings();
      // এডিট সেকশন রিফ্রেশ
      if (hasSearched && filterQuery) fetchEntries(page, filterMonth, filterYear, filterQuery);
    };
    window.addEventListener('meal-data-changed', handler);
    return () => window.removeEventListener('meal-data-changed', handler);
  }, [amoOrderDate, monthlyMealMonth, monthlyMealYear, delSearchHasSearched, delSearchQuery, delSearchPage, hasSearched, filterQuery, filterMonth, filterYear, page, marketExpenseSearchMonth, marketExpenseSearchYear, marketExpenseResults.length, rannaCookingDate]);

  const fetchAllForBalance = useCallback(async () => {
    setBalanceLoading(true);
    try {
      const res = await fetch('/api/balance');
      const data = await res.json();
      if (data.success) {
        setBalanceEmployees(data.employees || []);
        setBalanceLoaded(true);
      }
    } catch { toast({ title: 'এরর', description: 'ব্যালেন্স ডাটা লোড হয়নি', variant: 'destructive' }); }
    finally { setBalanceLoading(false); }
  }, [toast]);

  // ===== এডিট ফর্ম ফিল্ড: টাইপ করলে সাজেশন =====
  let editFormSuggestTimer: ReturnType<typeof setTimeout>;
  const handleEditFormFieldChange = (key: string, value: string) => {
    setEditForm(prev => ({ ...prev, [key]: value }));
    if (key === 'officeId' || key === 'name' || key === 'mobile') {
      setEditFormSuggestField(key);
      clearTimeout(editFormSuggestTimer);
      const cleaned = bnToEn(value.trim());
      if (!cleaned || (key === 'officeId' && cleaned.length < 2) || (key === 'name' && cleaned.length < 2) || (key === 'mobile' && cleaned.replace(/\D/g, '').length < 4)) {
        setEditFormSuggestions([]); setEditFormSuggestOpen(false); return;
      }
      editFormSuggestTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/entries?action=suggest&query=${encodeURIComponent(cleaned)}&field=${encodeURIComponent(key)}`);
          const data = await res.json();
          if (data.success && data.users) {
            setEditFormSuggestions(data.users);
            setEditFormSuggestOpen(data.users.length > 0);
          } else { setEditFormSuggestions([]); setEditFormSuggestOpen(false); }
        } catch { setEditFormSuggestions([]); setEditFormSuggestOpen(false); }
      }, 300);
    }
    if (key === 'designation') {
      setEditFormSuggestField('designation');
      clearTimeout(editFormSuggestTimer);
      const cleaned = value.trim();
      if (!cleaned || cleaned.length < 1) { setEditFormSuggestions([]); setEditFormSuggestOpen(false); return; }
      editFormSuggestTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/entries?action=suggest&query=${encodeURIComponent(bnToEn(cleaned))}&field=designation`);
          const data = await res.json();
          if (data.success && data.users) {
            setEditFormSuggestions(data.users);
            setEditFormSuggestOpen(data.users.length > 0);
          } else { setEditFormSuggestions([]); setEditFormSuggestOpen(false); }
        } catch { setEditFormSuggestions([]); setEditFormSuggestOpen(false); }
      }, 300);
    }
  };
  const handleEditFormSuggestionSelect = (user: LookupUser) => {
    setEditForm(prev => ({
      ...prev,
      officeId: user.officeId || prev.officeId,
      name: user.name || prev.name,
      mobile: formatMobile(user.mobile || prev.mobile),
      designation: user.designation || '',
    }));
    setEditFormSuggestions([]);
    setEditFormSuggestOpen(false);
  };

  // ===== এডিট সেকশন: টাইপ করলে সাজেশন / মোবাইল প্রিভিউ =====
  let editSuggestTimer: ReturnType<typeof setTimeout>;
  const handleEditSearchTyping = (value: string) => {
    setFilterQuery(value);
    setEditLookupPreview(null);
    clearTimeout(editSuggestTimer);
    if (!value || value.length < 2) { setEditSuggestions([]); setEditSuggestOpen(false); return; }
    const cleaned = bnToEn(value.trim()).replace(/\D/g, '');
    // মোবাইল নম্বর হলে (বেশিরভাগ ডিজিট) → লুকআপ করে নিচে নাম+পদবী দেখান
    if (cleaned.length >= 4 && /^\d+$/.test(bnToEn(value.trim()))) {
      setEditLookupPreviewLoading(true);
      fetch(`/api/entries?action=lookup&query=${encodeURIComponent(bnToEn(value.trim()))}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.users && data.users.length > 0) {
            setEditLookupPreview(data.users[0]);
          } else {
            setEditLookupPreview(null);
          }
        })
        .catch(() => setEditLookupPreview(null))
        .finally(() => setEditLookupPreviewLoading(false));
      // মোবাইল দিয়েও সাজেশন আনুন
    }
    // সাজেশন আনুন (নাম/আইডি/মোবাইল)
    editSuggestTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/entries?action=suggest&query=${encodeURIComponent(bnToEn(value.trim()))}`);
        const data = await res.json();
        if (data.success && data.users) {
          setEditSuggestions(data.users);
          setEditSuggestOpen(data.users.length > 0);
        } else {
          setEditSuggestions([]);
          setEditSuggestOpen(false);
        }
      } catch { setEditSuggestions([]); setEditSuggestOpen(false); }
    }, 300);
  };

  // এডিট সেকশন: সাজেশন সিলেক্ট করলে ফর্ম ফিল করুন
  const handleEditSuggestionSelect = (user: LookupUser) => {
    setEditSuggestions([]);
    setEditSuggestOpen(false);
    setEditLookupPreview(user);
    // সরাসরি এডিট ফর্মে ডাটা সেট করুন
    setEditEntry({
      id: '__edit__', entryDate: '', month: '', year: '',
      officeId: user.officeId, name: user.name, mobile: user.mobile,
      breakfastCount: 0, lunchCount: 0, morningSpecial: 0, lunchSpecial: 0,
      totalBill: 0, deposit: 0, depositDate: '', prevBalance: 0, curBalance: 0,
    } as any);
    setEditForm({
      officeId: user.officeId || '',
      name: user.name || '',
      mobile: formatMobile(user.mobile || ''),
      designation: user.designation || '',
    });
    setEntries([{
      id: '__edit__', entryDate: '', month: '', year: '',
      officeId: user.officeId, name: user.name, mobile: user.mobile,
      breakfastCount: 0, lunchCount: 0, morningSpecial: 0, lunchSpecial: 0,
      totalBill: 0, deposit: 0, depositDate: '', prevBalance: 0, curBalance: 0,
    } as any]);
    setHasSearched(true);
  };

  // ===== Admin Data Edit Search =====
  const handleAdminSearch = () => {
    if (!filterQuery.trim()) {
      toast({ title: 'তথ্য সম্পূর্ণ দিন', description: 'অফিস আইডি, মোবাইল বা নাম লিখুন', variant: 'destructive' });
      return;
    }
    setHasSearched(true);
    setLoading(true);
    // Use lookup API to find the user
    fetch(`/api/entries?action=lookup&query=${encodeURIComponent(bnToEn(filterQuery.trim()))}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.users && data.users.length > 0) {
          const user = data.users[0];
          setEditEntry({ id: '__edit__', entryDate: '', month: '', year: '', officeId: user.officeId, name: user.name, mobile: user.mobile, breakfastCount: 0, lunchCount: 0, morningSpecial: 0, lunchSpecial: 0, totalBill: 0, deposit: 0, depositDate: '', prevBalance: 0, curBalance: 0 } as any);
          setEditForm({
            officeId: user.officeId,
            name: user.name || '',
            mobile: formatMobile(user.mobile || ''),
            designation: user.designation || '',
          });
          setEntries([{
            id: '__edit__', entryDate: '', month: '', year: '', officeId: user.officeId, name: user.name, mobile: user.mobile, breakfastCount: 0, lunchCount: 0, morningSpecial: 0, lunchSpecial: 0, totalBill: 0, deposit: 0, depositDate: '', prevBalance: 0, curBalance: 0,
          } as any]);
        } else {
          setEditEntry(null);
          setEntries([]);
        }
      })
      .catch(() => { toast({ title: 'এরর', description: 'সার্চ ব্যর্থ', variant: 'destructive' }); })
      .finally(() => setLoading(false));
  };

  // ===== রান্না (Special Meal) handlers =====
  const handleRannaSave = async () => {
    if (!rannaDate) {
      toast({ title: 'তথ্য দিন', description: 'তারিখ সিলেক্ট করুন', variant: 'destructive' });
      return;
    }
    if (!rannaMorningSpecial && !rannaLunchSpecial) {
      toast({ title: 'তথ্য দিন', description: 'কমপক্ষে একটি স্পেশাল মিল সিলেক্ট করুন', variant: 'destructive' });
      return;
    }
    setRannaSaving(true);
    try {
      const res = await fetch('/api/special-meal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderDate: rannaDate,
          morningSpecial: rannaMorningSpecial,
          lunchSpecial: rannaLunchSpecial,
        })
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'সেভ হয়েছে', description: data.message, variant: 'success' });
        fetchRannaSettings();
        if (rannaCookingDate === rannaDate) fetchRannaCookingView(rannaDate);
        dispatchMealDataChanged();
      } else {
        toast({ title: 'এরর', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'এরর', variant: 'destructive' });
    } finally {
      setRannaSaving(false);
    }
  };

  const fetchRannaSettings = async () => {
    try {
      const res = await fetch('/api/special-meal?action=list');
      const data = await res.json();
      if (data.success) {
        setRannaSettings(data.settings || []);
      }
    } catch { /* silent */ }
  };

  const fetchRannaCookingView = async (date: string) => {
    if (!date) return;
    setRannaCookingLoading(true);
    try {
      let url = `/api/special-meal?action=cooking_view&orderDate=${encodeURIComponent(date)}`;
      if (rannaSearch && rannaSearch.length >= 2) url += `&search=${encodeURIComponent(rannaSearch)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setRannaCookingData(data);
      } else {
        toast({ title: 'ত্রুটি', description: data.error, variant: 'destructive' });
        setRannaCookingData(null);
      }
    } catch {
      toast({ title: 'ত্রুটি', variant: 'destructive' });
      setRannaCookingData(null);
    } finally {
      setRannaCookingLoading(false);
    }
  };

  const handleRannaAdminEditOrder = async () => {
    if (!rannaEditOrder) return;
    setRannaEditSaving(true);
    try {
      const res = await fetch('/api/special-meal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId: rannaEditOrder.officeId,
          orderDate: rannaCookingDate,
          breakfast: Number(rannaEditOrder.breakfast) || 0,
          lunch: Number(rannaEditOrder.lunch) || 0,
          morningSpecial: Number(rannaEditOrder.morningSpecial) || 0,
          lunchSpecial: Number(rannaEditOrder.lunchSpecial) || 0,
        })
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'আপডেট হয়েছে', description: data.message, variant: 'success' });
        setRannaEditOrder(null);
        fetchRannaCookingView(rannaCookingDate);
        dispatchMealDataChanged();
      } else {
        toast({ title: 'এরর', description: data.error, variant: 'destructive' });
      }
    } catch { toast({ title: 'এরর', variant: 'destructive' }); }
    finally { setRannaEditSaving(false); }
  };

  const handleRannaAdminDeleteOrder = (officeId: string, name: string) => {
    setConfirmDialog({
      open: true,
      message: `${name} এর অর্ডার ডিলিট করতে চান?`,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/special-meal?action=admin_delete&orderDate=${encodeURIComponent(rannaCookingDate)}&officeId=${encodeURIComponent(officeId)}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            toast({ title: 'ডিলিট হয়েছে', description: data.message, variant: 'success' });
            fetchRannaCookingView(rannaCookingDate);
            dispatchMealDataChanged();
          } else {
            toast({ title: 'এরর', description: data.error, variant: 'destructive' });
          }
        } catch { toast({ title: 'এরর', variant: 'destructive' }); }
      }
    });
  };

  const handleRannaDeleteSetting = (orderDate: string) => {
    setConfirmDialog({
      open: true,
      message: 'এই তারিখের স্পেশাল মিল সেটিং ডিলিট করতে চান?',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/special-meal?orderDate=${encodeURIComponent(orderDate)}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            toast({ title: 'ডিলিট হয়েছে', description: data.message, variant: 'success' });
            fetchRannaSettings();
            if (rannaCookingDate === orderDate) fetchRannaCookingView(orderDate);
            dispatchMealDataChanged();
          } else {
            toast({ title: 'এরর', description: data.error, variant: 'destructive' });
          }
        } catch { toast({ title: 'এরর', variant: 'destructive' }); }
      }
    });
  };

  // Load ranna settings when panel opens + set default date to tomorrow
  useEffect(() => {
    if (activePanel === 'rannaPanel') {
      fetchRannaSettings();
      // ডিফল্ট তারিখ = আগামীকাল
      const now = new Date();
      const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
      const bdMs = utcMs + 6 * 60 * 60000;
      const bd = new Date(bdMs);
      bd.setDate(bd.getDate() + 1);
      const dd = String(bd.getDate()).padStart(2, '0');
      const mm = String(bd.getMonth() + 1).padStart(2, '0');
      const yyyy = bd.getFullYear();
      setRannaDate(`${yyyy}-${mm}-${dd}`);
    }
  }, [activePanel]);

  // ===== Edit/Delete Entry =====
  const handleDeleteEntry = async (id: string) => {
    setConfirmDialog({
      open: true,
      message: 'এই এন্ট্রি ডিলিট করতে চান?',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/entries?id=${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            toast({ title: 'ডিলিট হয়েছে', description: data.message, variant: 'success' });
            fetchEntries(page); fetchAmoOrders(); dispatchMealDataChanged();
          } else toast({ title: 'এরর', description: data.error, variant: 'destructive' });
        } catch { toast({ title: 'এরর', variant: 'destructive' }); }
      }
    });
  };

  const openEditEntry = (entry: MealEntry) => {
    setEditEntry(entry);
    setEditForm({
      officeId: entry.officeId, name: entry.name,
      mobile: entry.mobile, designation: (entry as any).designation || '',
    });
  };

  const handleSaveEntry = async () => {
    if (!editEntry) return;
    setEditLoading(true);
    try {
      // update_member action — শুধু মেম্বার তথ্য আপডেট করুন, সব entry তে
      const res = await fetch('/api/entries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_member',
          targetOfficeId: editForm.officeId || editEntry.officeId,
          name: editForm.name || '',
          mobile: bnToEn(editForm.mobile || ''),
          designation: editForm.designation || '',
        })
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'আপডেট হয়েছে', description: data.message, variant: 'success' });
        setEditEntry(null);
        if (hasSearched) fetchEntries(page);
        fetchAmoOrders(); dispatchMealDataChanged();
      } else toast({ title: 'এরর', description: data.error, variant: 'destructive' });
    } catch { toast({ title: 'এরর', variant: 'destructive' }); }
    finally { setEditLoading(false); }
  };

  // ===== Generic Lookup Helper =====
  const doLookup = async (query: string, setResult: (r: LookupUser | null) => void, field: 'officeId' | 'mobile' | 'name', setForm: (fn: (prev: Record<string, string>) => Record<string, string>) => void) => {
    if (!query || query.length < 2) { setResult(null); return; }
    try {
      const res = await fetch(`/api/entries?action=lookup&query=${encodeURIComponent(bnToEn(query))}`);
      const data = await res.json();
      if (data.success && data.users && data.users.length > 0) {
        setResult(data.users[0]);
        const user = data.users[0];
        // When found, fill ALL fields (officeId, name, mobile, designation)
        setForm((prev: Record<string, string>) => ({
          ...prev,
          officeId: user.officeId || '',
          name: user.name || '',
          mobile: formatMobile(user.mobile || ''),
          designation: user.designation || '',
        }));
      } else {
        // Not found — set a special marker so UI can show "not found" message
        setResult({ officeId: '__not_found__', name: '', mobile: '', designation: '' });
      }
    } catch { setResult(null); }
  };

  // ===== নাম সাজেশন (অটোকমপ্লিট) =====
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // সাজেশন সিলেক্ট হলে blur lookup স্কিপ করতে ফ্ল্যাগ
  const justSelectedRef = useRef(false);

  const fetchSuggestions = (value: string, field: string, setSuggestions: (s: LookupUser[]) => void, setOpen: (o: boolean) => void) => {
    clearTimeout(suggestTimerRef.current);
    if (!value || (field !== 'designation' && value.length < 2)) { setSuggestions([]); setOpen(false); return; }
    if (field === 'designation' && value.length < 1) { setSuggestions([]); setOpen(false); return; }
    suggestTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/entries?action=suggest&query=${encodeURIComponent(bnToEn(value))}&field=${encodeURIComponent(field)}`);
        const data = await res.json();
        if (data.success && data.users) {
          setSuggestions(data.users);
          setOpen(data.users.length > 0);
        } else { setSuggestions([]); setOpen(false); }
      } catch { setSuggestions([]); setOpen(false); }
    }, 300);
  };

  const selectSuggestion = (
    user: LookupUser,
    setForm: (fn: (prev: Record<string, string>) => Record<string, string>) => void,
    setSuggestions: (s: LookupUser[]) => void,
    setOpen: (o: boolean) => void,
    setLookupResult: (r: LookupUser | null) => void,
  ) => {
    justSelectedRef.current = true;
    setTimeout(() => { justSelectedRef.current = false; }, 500);
    setForm((prev: Record<string, string>) => ({
      ...prev,
      officeId: user.officeId || '',
      name: user.name || '',
      mobile: formatMobile(user.mobile || ''),
      designation: user.designation || '',
    }));
    setSuggestions([]);
    setOpen(false);
    setLookupResult(user);
  };

  // ===== মিল এন্ট্রি handlers =====
  const handleMealFormChange = (key: string, value: string) => {
    setMealForm(prev => ({ ...prev, [key]: value }));
    // নাম, আইডি, মোবাইল বা পদবী টাইপ করলে সাজেশন আনুন
    if (key === 'name' || key === 'officeId' || key === 'mobile') {
      setMealSuggestField(key);
      fetchSuggestions(value, key, setMealSuggestions, setMealSuggestOpen);
    }
    if (key === 'designation') {
      setMealSuggestField('designation');
      fetchSuggestions(value, 'designation', setMealSuggestions, setMealSuggestOpen);
    }
  };
  const handleMealFieldBlur = (key: string) => {
    setMealSuggestOpen(false);
    // সাজেশন সিলেক্ট হলে blur lookup স্কিপ
    if (justSelectedRef.current) return;
    if (key !== 'officeId' && key !== 'mobile' && key !== 'name') return;
    const query = mealForm[key];
    if (!query || query.length < 2) { setMealLookupResult(null); return; }
    setMealLookupLoading(true);
    doLookup(query, setMealLookupResult, key as 'officeId' | 'mobile' | 'name', setMealForm)
      .finally(() => setMealLookupLoading(false));
  };

  const handleMealSave = async () => {
    if ((!mealForm.officeId && !mealForm.name && !mealForm.mobile) || !mealForm.month || !mealForm.year) {
      toast({ title: 'তথ্য সম্পূর্ণ দিন', description: 'অফিস আইডি/নাম/মোবাইল, মাস ও বছর পূরণ করুন', variant: 'destructive' });
      return;
    }
    setMealSaving(true);
    try {
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...mealForm,
          officeId: bnToEn(mealForm.officeId),
          mobile: bnToEn(mealForm.mobile || ''),
          breakfastCount: bnToEn(mealForm.breakfastCount || '0'),
          lunchCount: bnToEn(mealForm.lunchCount || '0'),
          morningSpecial: bnToEn(mealForm.morningSpecial || '0'),
          lunchSpecial: bnToEn(mealForm.lunchSpecial || '0'),
          deposit: '0',
          depositDate: ''
        })
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'সেভ হয়েছে', description: 'মিল এন্ট্রি যোগ হয়েছে', variant: 'success' });
        const now = new Date();
        const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
        const bdMs = utcMs + 6 * 60 * 60000;
        const bd = new Date(bdMs);
        const dd = String(bd.getDate()).padStart(2, '0');
        const mm = String(bd.getMonth() + 1).padStart(2, '0');
        const yyyy = bd.getFullYear();
        setMealForm({ month: currentMonth, year: currentYear, entryDate: `${yyyy}-${mm}-${dd}` });
        setMealLookupResult(null);
        fetchAmoOrders(); fetchEntries(); dispatchMealDataChanged(); setBalanceLoaded(false);
      } else toast({ title: 'এরর', description: data.error, variant: 'destructive' });
    } catch { toast({ title: 'এরর', variant: 'destructive' }); }
    finally { setMealSaving(false); }
  };

  // ===== Admin মিল অর্ডার handlers =====
  const { toast: amoToast } = useToast();

  const handleAmoSuggest = (value: string) => {
    setAmoQuery(value);
    setAmoSelectedUser(null);
    setAmoNotFound(false);
    clearTimeout(amoSuggestTimer);
    if (!value || value.length < 2) { setAmoSuggestions([]); setAmoSuggestOpen(false); return; }
    setAmoSuggestTimer(setTimeout(async () => {
      try {
        const res = await fetch(`/api/meal-order?action=suggest&query=${encodeURIComponent(value)}`);
        const data = await res.json();
        if (data.success && data.users && data.users.length > 0) {
          setAmoSuggestions(data.users);
          setAmoSuggestOpen(true);
          setAmoNotFound(false);
        } else { setAmoSuggestions([]); setAmoSuggestOpen(false); setAmoNotFound(true); }
      } catch { setAmoSuggestions([]); setAmoSuggestOpen(false); }
    }, 300));
  };

  const handleAmoSelectUser = (user: any) => {
    setAmoSelectedUser(user);
    setAmoSuggestions([]);
    setAmoSuggestOpen(false);
    setAmoQuery(user.name || user.officeId);
  };

  const fetchAmoOrders = async () => {
    try {
      const res = await fetch(`/api/meal-order?action=list&orderDate=${amoOrderDate}`);
      const data = await res.json();
      if (data.success) setAmoOrders(data.orders || []);
    } catch {}
  };

  const handleAmoSave = async () => {
    if (!amoSelectedUser) { amoToast({ title: 'তথ্য সম্পূর্ণ দিন', description: 'অর্ডারকারী সিলেক্ট করুন', variant: 'destructive' }); return; }
    if (!amoBreakfast && !amoLunch && !amoMorningSpecial && !amoLunchSpecial) { amoToast({ title: 'তথ্য সম্পূর্ণ দিন', description: 'কমপক্ষে একটি মিল সিলেক্ট করুন', variant: 'destructive' }); return; }
    // তারিখ থেকে মাস ও বছর বের করুন
    const dateParts = amoOrderDate.split('-');
    const amoMonthIdx = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2])).getMonth();
    const amoMonth = MONTHS_NO_ALL[amoMonthIdx];
    const amoYear = dateParts[0];
    setAmoSaving(true);
    try {
      const res = await fetch('/api/meal-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId: amoSelectedUser.officeId, name: amoSelectedUser.name, mobile: amoSelectedUser.mobile, designation: amoSelectedUser.designation,
          orderDate: amoOrderDate, month: amoMonth, year: amoYear,
          breakfast: amoBreakfast, lunch: amoLunch, morningSpecial: amoMorningSpecial, lunchSpecial: amoLunchSpecial,
        })
      });
      const data = await res.json();
      if (data.success) {
        amoToast({ title: 'সেভ হয়েছে', description: `${amoSelectedUser.name} — মিল অর্ডার সেভ হয়েছে`, variant: 'success' });
        setAmoSelectedUser(null); setAmoQuery(''); setAmoBreakfast(0); setAmoLunch(0); setAmoMorningSpecial(0); setAmoLunchSpecial(0);
        fetchAmoOrders(); fetchEntries(); dispatchMealDataChanged(); setBalanceLoaded(false);
      } else { amoToast({ title: 'এরর', description: data.error, variant: 'destructive' }); }
    } catch { amoToast({ title: 'এরর', variant: 'destructive' }); }
    finally { setAmoSaving(false); }
  };

  const handleAmoDeleteOrder = async (officeId: string) => {
    try {
      const res = await fetch(`/api/meal-order?officeId=${encodeURIComponent(officeId)}&orderDate=${amoOrderDate}`, { method: 'DELETE', headers: { 'x-admin-token': getAdminToken() || '', 'x-admin-password': getAdminPassword() } });
      const data = await res.json();
      if (data.success) { amoToast({ title: 'ডিলিট হয়েছে', description: data.message }); fetchAmoOrders(); fetchEntries(); dispatchMealDataChanged(); setBalanceLoaded(false); }
      else { amoToast({ title: 'এরর', description: data.error, variant: 'destructive' }); }
    } catch { amoToast({ title: 'এরর', variant: 'destructive' }); }
  };

  // Admin order inline edit save
  const handleAmoEditSave = async () => {
    if (!amoEditOrder) return;
    setAmoEditSaving(true);
    try {
      const res = await fetch('/api/meal-order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': getAdminToken() || '', 'x-admin-password': getAdminPassword() },
        body: JSON.stringify({
          officeId: amoEditOrder.officeId,
          orderDate: amoOrderDate,
          breakfast: amoEditOrder.breakfast,
          lunch: amoEditOrder.lunch,
          morningSpecial: amoEditOrder.morningSpecial,
          lunchSpecial: amoEditOrder.lunchSpecial,
          isAdmin: true,
        })
      });
      const data = await res.json();
      if (data.success) {
        amoToast({ title: 'আপডেট হয়েছে', description: data.message });
        setAmoEditOrder(null);
        fetchAmoOrders(); fetchEntries(); dispatchMealDataChanged(); setBalanceLoaded(false);
      } else { amoToast({ title: 'এরর', description: data.error, variant: 'destructive' }); }
    } catch { amoToast({ title: 'এরর', variant: 'destructive' }); }
    finally { setAmoEditSaving(false); }
  };

  // Admin order edit: change count
  const handleAmoEditCount = (field: string, delta: number) => {
    if (!amoEditOrder) return;
    setAmoEditOrder({ ...amoEditOrder, [field]: Math.max(0, (amoEditOrder[field] || 0) + delta) });
  };

  // Admin মিল অর্ডার বিল ক্যালকুলেশন
  const getAmoOrderBill = (counts: { breakfast?: number; lunch?: number; morningSpecial?: number; lunchSpecial?: number }) => {
    if (!amoOrderDate) return 0;
    const dp = amoOrderDate.split('-');
    const mIdx = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2])).getMonth();
    const ps = settings.find(s => s.month === MONTHS_NO_ALL[mIdx] && s.year === dp[0]);
    if (!ps) return 0;
    return (counts.breakfast || 0) * ps.breakfastPrice + (counts.lunch || 0) * ps.lunchPrice + (counts.morningSpecial || 0) * ps.morningSpecial + (counts.lunchSpecial || 0) * ps.lunchSpecial;
  };

  // Admin মিল অর্ডার প্যানেল খোলার সময় আজকের তারিখ সেট + অটো রিফ্রেশ
  // ===== One-time duplicate cleanup: existing duplicate entries merge =====
  const dupCleanedRef = useRef(false);
  useEffect(() => {
    if (activePanel === 'adminMealOrder' && !dupCleanedRef.current) {
      dupCleanedRef.current = true;
      fetch('/api/entries?action=merge_duplicates', { method: 'GET' }).catch(() => {});
    }
    if (activePanel === 'adminMealOrder' && !amoOrderDate) {
      const now = new Date();
      const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
      const bdMs = utcMs + 6 * 60 * 60000;
      const bd = new Date(bdMs);
      const dd = String(bd.getDate()).padStart(2, '0');
      const mm = String(bd.getMonth() + 1).padStart(2, '0');
      const yyyy = bd.getFullYear();
      setAmoOrderDate(`${yyyy}-${mm}-${dd}`);
    }
  }, [activePanel, amoOrderDate]);
  // তারিখ পরিবর্তন হলে অটো রিফ্রেশ
  useEffect(() => {
    if (activePanel === 'adminMealOrder' && amoOrderDate) fetchAmoOrders();
  }, [amoOrderDate, activePanel]);

  // ===== টাকা জমা এন্ট্রি handlers =====
  const handleDepositFormChange = (key: string, value: string) => {
    setDepositForm(prev => ({ ...prev, [key]: value }));
    if (key === 'name' || key === 'officeId' || key === 'mobile') {
      setDepositSuggestField(key);
      fetchSuggestions(value, key, setDepositSuggestions, setDepositSuggestOpen);
    }
    if (key === 'designation') {
      setDepositSuggestField('designation');
      fetchSuggestions(value, 'designation', setDepositSuggestions, setDepositSuggestOpen);
    }
  };
  const handleDepositFieldBlur = (key: string) => {
    setDepositSuggestOpen(false);
    // সাজেশন সিলেক্ট হলে blur lookup স্কিপ
    if (justSelectedRef.current) return;
    if (key !== 'officeId' && key !== 'mobile' && key !== 'name') return;
    const query = depositForm[key];
    if (!query || query.length < 2) { setDepositLookupResult(null); return; }
    setDepositLookupLoading(true);
    doLookup(query, setDepositLookupResult, key as 'officeId' | 'mobile' | 'name', setDepositForm)
      .finally(() => setDepositLookupLoading(false));
  };

  const handleDepositLookupInfo = async () => {
    const query = depositForm.officeId || depositForm.mobile;
    if (!query || !depositForm.month || !depositForm.year) {
      toast({ title: 'তথ্য সম্পূর্ণ দিন', description: 'মাস, বছর এবং আইডি/মোবাইল তিনটি ঘর পূরণ করুন', variant: 'destructive' });
      return;
    }
    setDepositInfoLoading(true);
    try {
      const params = new URLSearchParams({ action: 'search', query: bnToEn(query.trim()), month: depositForm.month, year: depositForm.year });
      const res = await fetch(`/api/entries?${params}`);
      const data = await res.json();
      setDepositInfo(data);
    } catch { setDepositInfo({ success: false, error: 'নেটওয়ার্ক এরর' }); }
    finally { setDepositInfoLoading(false); }
  };

  const handleDepositSave = async () => {
    if ((!depositForm.officeId && !depositForm.name && !depositForm.mobile) || !depositForm.month || !depositForm.year) {
      toast({ title: 'তথ্য সম্পূর্ণ দিন', description: 'অফিস আইডি/নাম/মোবাইল, মাস ও বছর পূরণ করুন', variant: 'destructive' });
      return;
    }
    if (!depositForm.deposit || depositForm.deposit === '0') {
      toast({ title: 'তথ্য সম্পূর্ণ দিন', description: 'জমার পরিমাণ দিন', variant: 'destructive' });
      return;
    }
    setDepositSaving(true);
    try {
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId: bnToEn(depositForm.officeId),
          name: depositForm.name || '',
          mobile: bnToEn(depositForm.mobile || ''),
          month: depositForm.month,
          year: depositForm.year,
          entryDate: depositForm.depositDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }),
          breakfastCount: '0',
          lunchCount: '0',
          morningSpecial: '0',
          lunchSpecial: '0',
          deposit: bnToEn(depositForm.deposit || '0'),
          depositDate: depositForm.depositDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
        })
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'সেভ হয়েছে', description: 'টাকা জমা এন্ট্রি যোগ হয়েছে', variant: 'success' });
        setDepositForm({ month: currentMonth, year: currentYear });
        setDepositLookupResult(null);
        setDepositInfo(null);
        setBalanceLoaded(false);
        fetchAmoOrders(); fetchEntries(); dispatchMealDataChanged();
      } else toast({ title: 'এরর', description: data.error, variant: 'destructive' });
    } catch { toast({ title: 'এরর', variant: 'destructive' }); }
    finally { setDepositSaving(false); }
  };

  // ===== সদস্য যোগ handlers =====
  const handleMemberFormChange = (key: string, value: string) => {
    setMemberForm(prev => ({ ...prev, [key]: value }));
    // অফিস আইডি, নাম, মোবাইল বা পদবী টাইপ করলে সাজেশন আনুন
    if (key === 'officeId' || key === 'name' || key === 'mobile') {
      setMemberSuggestField(key);
      fetchSuggestions(value, key, setMemberSuggestions, setMemberSuggestOpen);
    }
    if (key === 'designation') {
      setMemberSuggestField('designation');
      fetchSuggestions(value, 'designation', setMemberSuggestions, setMemberSuggestOpen);
    }
  };
  const handleMemberFieldBlur = (key: string) => {
    // সদস্য যোগে: অফিস আইডি অথবা মোবাইল — যেকোনো একটি ম্যাচ করলে ব্লক
    // MealEntry + MealOrder + MealUser তিন টেবিলে খুঁজবে
    setMemberSuggestOpen(false);
    // সাজেশন সিলেক্ট হলে blur lookup স্কিপ
    if (justSelectedRef.current) return;
    if (key !== 'officeId' && key !== 'mobile') return;

    const oid = memberForm.officeId?.trim() || '';
    const mob = memberForm.mobile?.trim() || '';
    const mobDigits = mob.replace(/\D/g, '');

    // অন্তত একটি ভ্যালু থাকতে হবে
    if (!oid && mobDigits.length < 4) { setMemberLookupResult(null); return; }

    setMemberLookupLoading(true);
    (async () => {
      try {
        // check-duplicate একশনে অফিস আইডি ও মোবাইল দুটোই পাঠানো হবে
        const params = new URLSearchParams();
        params.set('action', 'check-duplicate');
        if (oid) params.set('officeId', bnToEn(oid));
        if (mobDigits.length >= 4) params.set('mobile', bnToEn(mob));
        const res = await fetch(`/api/entries?${params.toString()}`);
        const data = await res.json();
        if (data.success && data.duplicate && data.user) {
          setMemberLookupResult(data.user);
        } else {
          setMemberLookupResult(null);
        }
      } catch { setMemberLookupResult(null); }
      finally { setMemberLookupLoading(false); }
    })();
  };

  const handleMemberSave = async () => {
    // সকল ফিল্ড পূরণ আবশ্যক
    if (!memberForm.officeId?.trim() || !memberForm.name?.trim() || !memberForm.mobile?.trim() || !memberForm.designation?.trim()) {
      toast({ title: 'সকল ফিল্ড পূরণ করুন', description: 'অফিস আইডি, নাম, মোবাইল ও পদবী দিতে হবে', variant: 'destructive' });
      return;
    }
    // ডুপ্লিকেট চেক — একই আইডি বা মোবাইল থাকলে যোগ করা যাবে না
    if (memberLookupResult && memberLookupResult.officeId !== '__not_found__') {
      const matchedBy = (memberLookupResult as any).matchedBy;
      if (matchedBy === 'officeId') {
        toast({ title: 'এই অফিস আইডি আগে থেকেই আছে', description: `${memberLookupResult.name} (${memberLookupResult.officeId}) — পুনরায় যোগ করা যাবে না`, variant: 'destructive' });
      } else {
        toast({ title: 'এই মোবাইল নম্বর আগে থেকেই আছে', description: `${memberLookupResult.name} (${formatMobile(memberLookupResult.mobile || '')}) — পুনরায় যোগ করা যাবে না`, variant: 'destructive' });
      }
      return;
    }
    // সার্ভারে আবার ডুপ্লিকেট চেক করুন (blur ছাড়াই সরাসরি যোগ করলে)
    setMemberSaving(true);
    try {
      // সার্ভার সাইড ডুপ্লিকেট চেক
      const checkParams = new URLSearchParams();
      checkParams.set('action', 'check-duplicate');
      checkParams.set('officeId', bnToEn(memberForm.officeId || ''));
      checkParams.set('mobile', bnToEn(memberForm.mobile || ''));
      const checkRes = await fetch(`/api/entries?${checkParams.toString()}`);
      const checkData = await checkRes.json();
      if (checkData.success && checkData.duplicate && checkData.user) {
        const dupUser = checkData.user;
        const dupBy = checkData.matchedBy;
        if (dupBy === 'officeId') {
          toast({ title: 'এই অফিস আইডি আগে থেকেই আছে', description: `${dupUser.name} (${dupUser.officeId}) — পুনরায় যোগ করা যাবে না`, variant: 'destructive' });
        } else {
          toast({ title: 'এই মোবাইল নম্বর আগে থেকেই আছে', description: `${dupUser.name} (${formatMobile(dupUser.mobile || '')}) — পুনরায় যোগ করা যাবে না`, variant: 'destructive' });
        }
        setMemberLookupResult(dupUser);
        setMemberSaving(false);
        return;
      }
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId: bnToEn(memberForm.officeId || ''),
          name: memberForm.name || '',
          mobile: bnToEn(memberForm.mobile || ''),
          month: currentMonth,
          year: currentYear,
          breakfastCount: '0',
          lunchCount: '0',
          morningSpecial: '0',
          lunchSpecial: '0',
          deposit: '0',
          depositDate: '',
          designation: memberForm.designation || '',
        })
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'সেভ হয়েছে', description: 'সদস্যের মিল এন্ট্রি যোগ হয়েছে', variant: 'success' });
        setMemberForm({});
        setMemberLookupResult(null);
        setFilterQuery('');
        fetchEntries(1, currentMonth, currentYear, '');
        fetchAmoOrders(); dispatchMealDataChanged();
      } else {
        toast({ title: 'যোগ করা যায়নি', description: data.error, variant: 'destructive' });
      }
    } catch { toast({ title: 'এরর', variant: 'destructive' }); }
    finally { setMemberSaving(false); }
  };

  // ===== বাজার খরচ handlers =====
  const handleMarketExpenseSave = async () => {
    if (!marketExpenseForm.expenseDate || !marketExpenseForm.totalCost) {
      toast({ title: 'তথ্য সম্পূর্ণ দিন', description: 'তারিখ ও খরচ পূরণ করুন', variant: 'destructive' });
      return;
    }
    setMarketExpenseSaving(true);
    try {
      const res = await fetch('/api/market-expense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenseDate: marketExpenseForm.expenseDate,
          description: marketExpenseForm.description || '',
          totalCost: bnToEn(marketExpenseForm.totalCost || '0'),
        })
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'সেভ হয়েছে', description: 'বাজার খরচ যোগ হয়েছে', variant: 'success' });
        setMarketExpenseForm({
          expenseDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }),
        });
        if (marketExpenseSearchMonth && marketExpenseSearchYear) handleMarketExpenseSearch();
      } else toast({ title: 'এরর', description: data.error, variant: 'destructive' });
    } catch { toast({ title: 'এরর', variant: 'destructive' }); }
    finally { setMarketExpenseSaving(false); }
  };

  const handleMarketExpenseSearch = async () => {
    if (!marketExpenseSearchMonth || !marketExpenseSearchYear) {
      toast({ title: 'তথ্য দিন', description: 'মাস ও বছর সিলেক্ট করুন', variant: 'destructive' });
      return;
    }
    setMarketExpenseLoading(true);
    setMarketExpenseDetailsOpen(false);
    try {
      const params = new URLSearchParams({ action: 'list', month: marketExpenseSearchMonth, year: marketExpenseSearchYear });
      const res = await fetch(`/api/market-expense?${params}`);
      const data = await res.json();
      if (data.success) {
        setMarketExpenseResults(data.expenses || []);
        setMarketExpenseTotal(data.totalCost || 0);
      } else toast({ title: 'ত্রুটি', description: data.error, variant: 'destructive' });
    } catch { toast({ title: 'ত্রুটি', variant: 'destructive' }); }
    finally { setMarketExpenseLoading(false); }
  };

  const handleMarketExpenseEdit = (expense: any) => {
    setMarketExpenseEditId(expense.id);
    setMarketExpenseEditForm({
      expenseDate: expense.expenseDate || '',
      description: expense.description || '',
      totalCost: String(expense.totalCost || 0),
    });
  };

  const handleMarketExpenseEditSave = async () => {
    if (!marketExpenseEditId) return;
    setMarketExpenseEditSaving(true);
    try {
      const res = await fetch('/api/market-expense', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: marketExpenseEditId,
          ...marketExpenseEditForm,
          totalCost: bnToEn(marketExpenseEditForm.totalCost || '0'),
        })
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'আপডেট হয়েছে', description: data.message, variant: 'success' });
        setMarketExpenseEditId(null);
        if (marketExpenseSearchMonth && marketExpenseSearchYear) handleMarketExpenseSearch();
      } else toast({ title: 'এরর', description: data.error, variant: 'destructive' });
    } catch { toast({ title: 'এরর', variant: 'destructive' }); }
    finally { setMarketExpenseEditSaving(false); }
  };

  const handleMarketExpenseDelete = (id: string) => {
    setConfirmDialog({
      open: true,
      message: 'এই খরচ ডিলিট করতে চান?',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/market-expense', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
          });
          const data = await res.json();
          if (data.success) {
            toast({ title: 'ডিলিট হয়েছে', description: data.message, variant: 'success' });
            if (marketExpenseSearchMonth && marketExpenseSearchYear) handleMarketExpenseSearch();
          } else toast({ title: 'এরর', description: data.error, variant: 'destructive' });
        } catch { toast({ title: 'এরর', variant: 'destructive' }); }
      }
    });
  };

  // ===== মাস অনুযায়ী মোট মিল handler =====
  const handleMonthlyMealSearch = async () => {
    if (!monthlyMealMonth || !monthlyMealYear) {
      toast({ title: 'তথ্য সম্পূর্ণ দিন', description: 'মাস ও বছর সিলেক্ট করুন', variant: 'destructive' });
      return;
    }
    setMonthlyMealLoading(true);
    try {
      const params = new URLSearchParams({ action: 'summary', month: monthlyMealMonth, year: monthlyMealYear });
      const res = await fetch(`/api/meal-order?${params}`);
      const data = await res.json();
      if (data.success) {
        setMonthlyMealSummary(data);
        setMonthlyMealExpandedRows(new Set());
        setMonthlyMealDetailsOpen(false);
      } else {
        toast({ title: 'ত্রুটি', description: data.error, variant: 'destructive' });
        setMonthlyMealSummary(null);
      }
    } catch {
      toast({ title: 'এরর', variant: 'destructive' });
      setMonthlyMealSummary(null);
    }
    finally { setMonthlyMealLoading(false); }
  };

  // ===== Setting handlers =====
  const handleSaveSetting = async () => {
    setEditLoading(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editSetting!.id, ...settingForm })
      });
      const data = await res.json();
      if (data.success) { toast({ title: 'আপডেট হয়েছে', variant: 'success' }); setEditSetting(null); fetchSettings(); dispatchMealDataChanged(); }
    } catch { toast({ title: 'এরর', variant: 'destructive' }); }
    finally { setEditLoading(false); }
  };

  const handleDeleteSetting = async (id: string) => {
    setConfirmDialog({
      open: true,
      message: 'এই সেটিং ডিলিট করতে চান?',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/settings?id=${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) { toast({ title: 'ডিলিট হয়েছে', variant: 'success' }); fetchSettings(); dispatchMealDataChanged(); }
        } catch { toast({ title: 'এরর', variant: 'destructive' }); }
      }
    });
  };

  const handleNewSetting = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettingForm)
      });
      const data = await res.json();
      if (data.success) { toast({ title: 'সেভ হয়েছে', variant: 'success' }); setNewSettingOpen(false); setNewSettingForm({}); fetchSettings(); dispatchMealDataChanged(); }
      else toast({ title: 'এরর', description: data.error, variant: 'destructive' });
    } catch { toast({ title: 'এরর', variant: 'destructive' }); }
  };

  const fmtDate = (d: string) => {
    try {
      // entryDate format: "YYYY-MM-DDTHH:MM:SS.000" — সরাসরি date part ব্যবহার করুন
      const datePart = (d || '').substring(0, 10); // "YYYY-MM-DD"
      if (!datePart || datePart.length < 10 || !datePart.includes('-')) return d;
      const parts = datePart.split('-');
      const y = parseInt(parts[0]) || 0;
      const m = parseInt(parts[1]) || 1;
      const day = parseInt(parts[2]) || 1;
      const bnMonths = ['জানু', 'ফেব', 'মার্চ', 'এপ্রি', 'মে', 'জুন', 'জুলা', 'আগ', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'];
      return `${day.toLocaleString('bn-BD')} ${bnMonths[m - 1] || m}, ${y.toLocaleString('bn-BD')}`;
    } catch { return d; }
  };

  // ===== Excel ডাউনলোড — বকেয়া / অগ্রিম (HTML table XLS for Unicode) =====
  const downloadBalanceExcel = (type: 'due' | 'advance') => {
    const employees = type === 'due' ? filteredDueEmployees : filteredAdvanceEmployees;
    if (employees.length === 0) return;

    const label = type === 'due' ? 'বকেয়া টাকা' : 'অগ্রিম টাকা';
    const total = type === 'due'
      ? employees.reduce((s, e) => s + Math.abs(e.curBalance), 0)
      : employees.reduce((s, e) => s + e.curBalance, 0);

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>td,th{mso-number-format:"\\@";border:1px solid #ddd;padding:6px 10px;font-family:'Nirmala UI','SolaimanLipi',Arial,sans-serif;font-size:13px}
th{background:#f0f0f0;font-weight:bold;text-align:center}
.num{text-align:right;mso-number-format:"0"} .neg{color:red;font-weight:bold} .pos{color:#006600;font-weight:bold}
.footer td{font-weight:bold;background:#f9f9f9}</style></head>
<body><table>
<thead><tr><th>ক্রমিক</th><th>অফিস আইডি</th><th>নাম</th><th>পদবী</th><th>মোবাইল</th><th>পরিমাণ (টাকা)</th></tr></thead>
<tbody>${employees.map((e, i) => `<tr><td class="num">${i + 1}</td><td>${e.officeId}</td><td>${e.name || '—'}</td><td>${(e as any).designation || '—'}</td><td>${e.mobile || '—'}</td><td class="num ${type === 'due' ? 'neg' : 'pos'}">${type === 'due' ? Math.abs(e.curBalance) : e.curBalance}</td></tr>`).join('')}
<tr class="footer"><td colspan="5" style="text-align:right">মোট</td><td class="num ${type === 'due' ? 'neg' : 'pos'}">${total}</td></tr>
</tbody></table></body></html>`;

    const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type === 'due' ? 'বকেয়া_টাকা' : 'অগ্রিম_টাকা'}_${new Date().toISOString().split('T')[0]}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    const params = new URLSearchParams({ action: 'export' });
    if (csvMonth) params.set('adminMonth', csvMonth);
    if (csvYear) params.set('adminYear', csvYear);
    window.open(`/api/entries?${params}`, '_blank');
    setCsvOpen(false);
  };

  // ===== মোবাইল নম্বর সিঙ্ক =====
  const handleSyncMobile = async () => {
    setSyncMobileLoading(true);
    try {
      const res = await fetch('/api/entries?action=sync_mobile');
      const data = await res.json();
      if (data.success) {
        toast({ title: '✅ মোবাইল সিঙ্ক হয়েছে', description: data.message, variant: 'success' });
      } else {
        toast({ title: 'এরর', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'এরর', description: 'নেটওয়ার্ক সমস্যা', variant: 'destructive' });
    } finally {
      setSyncMobileLoading(false);
    }
  };

  // ===== সদস্য ইমপোর্ট handler functions =====
  const extractMemberSheetId = (url: string): string => {
    const patterns = [/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/, /\/d\/([a-zA-Z0-9-_]{20,})/];
    for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
    return '';
  };

  const handleMemberImportLoadSheets = async () => {
    const sid = extractMemberSheetId(memberImportUrl);
    if (!sid) {
      toast({ title: 'এরর', description: 'সঠিক Google Sheet URL দিন', variant: 'destructive' });
      return;
    }
    setMemberImportLoading(true);
    try {
      const res = await fetch(`/api/sheet?action=sheets&sheetId=${encodeURIComponent(sid)}`);
      const data = await res.json();
      if (data.success && data.sheets && data.sheets.length > 0) {
        setMemberImportSheets(data.sheets);
        setMemberImportStep('select');
        // একটি ট্যাব থাকলে অটো সিলেক্ট
        if (data.sheets.length === 1) {
          setMemberImportSelectedSheet(data.sheets[0].gid);
        }
      } else {
        toast({ title: 'ত্রুটি', description: data.error || 'শীট থেকে ট্যাব পাওয়া যায়নি', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'নেটওয়ার্ক সমস্যা', description: 'ইন্টারনেট কানেকশন চেক করুন', variant: 'destructive' });
    }
    setMemberImportLoading(false);
  };

  const handleMemberImportPreview = async () => {
    const sid = extractMemberSheetId(memberImportUrl);
    if (!sid || !memberImportSelectedSheet) return;
    setMemberImportLoading(true);
    try {
      const params = new URLSearchParams({
        action: 'preview',
        sheetId: sid,
        gid: memberImportSelectedSheet,
      });
      const res = await fetch(`/api/import-members?${params}`);
      const data = await res.json();
      if (data.success) {
        // অটো ডিটেক্টেড ম্যাপিং থেকে manual map ইনিশিয়ালাইজ করুন
        const initialMap: Record<string, string> = {};
        const usedFields = new Set<string>();
        for (const cm of (data.columnMapping || [])) {
          if (cm.field && cm.confidence >= 80 && !usedFields.has(cm.field)) {
            initialMap[cm.header] = cm.field;
            usedFields.add(cm.field);
          }
        }
        setMemberColumnMap(initialMap);
        setMemberImportPreview(data);
        setMemberImportStep('preview');
      } else {
        toast({ title: 'ত্রুটি', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'ত্রুটি', description: 'প্রিভিউ লোড করা যায়নি', variant: 'destructive' });
    }
    setMemberImportLoading(false);
  };

  const handleMemberImportSave = async () => {
    const sid = extractMemberSheetId(memberImportUrl);
    if (!sid || !memberImportSelectedSheet) return;
    setMemberImportSaving(true);
    try {
      const res = await fetch('/api/import-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetId: sid,
          gid: memberImportSelectedSheet,
          dryRun: false,
          columnMap: memberColumnMap,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMemberImportResult(data);
        setMemberImportStep('result');
        toast({
          title: 'ইমপোর্ট সম্পন্ন',
          description: `${data.created}টি নতুন সদস্য যোগ, ${data.updated}টি আপডেট`,
          variant: 'success',
        });
      } else {
        toast({ title: 'ত্রুটি', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'ত্রুটি', description: 'ইমপোর্ট ব্যর্থ হয়েছে', variant: 'destructive' });
    }
    setMemberImportSaving(false);
  };

  // ===== ডাটাবেজ ডিলিট - সাজেশন =====
  const delSuggestTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fetchDelSuggestions = (value: string, setSuggestions: (s: LookupUser[]) => void, setOpen: (o: boolean) => void) => {
    clearTimeout(delSuggestTimerRef.current);
    if (!value || value.length < 2) { setSuggestions([]); setOpen(false); return; }
    delSuggestTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/entries?action=suggest&query=${encodeURIComponent(value)}`);
        const data = await res.json();
        if (data.success && data.users) {
          setSuggestions(data.users);
          setOpen(data.users.length > 0);
        } else { setSuggestions([]); setOpen(false); }
      } catch { setSuggestions([]); setOpen(false); }
    }, 300);
  };

  // ===== Delete Dialog: Tab 1 - ব্যক্তিগত তথ্য Edit/Del =====
  const handleDelSearch = async (p = 1) => {
    if (!delSearchQuery.trim()) {
      toast({ title: 'তথ্য দিন', description: 'অফিস আইডি বা মোবাইল নম্বর লিখুন', variant: 'destructive' });
      return;
    }
    setDelSearchLoading(true);
    setDelSearchHasSearched(true);
    try {
      const params = new URLSearchParams({
        action: 'search_entries',
        query: bnToEn(delSearchQuery.trim()),
        page: String(p),
        limit: '50'
      });
      if (delSearchMonth) params.set('month', delSearchMonth);
      if (delSearchYear) params.set('year', delSearchYear);
      const res = await fetch(`/api/entries?${params}`);
      const data = await res.json();
      if (data.success) {
        setDelSearchResults(data.entries);
        setDelSearchTotal(data.total);
        setDelSearchPage(data.page);
        setDelSearchTotalPages(data.totalPages);
      } else {
        toast({ title: 'এরর', description: data.error, variant: 'destructive' });
        setDelSearchResults([]);
      }
    } catch {
      toast({ title: 'এরর', variant: 'destructive' });
      setDelSearchResults([]);
    } finally {
      setDelSearchLoading(false);
    }
  };

  const handleDelEditEntry = (entry: MealEntry) => {
    setEditingEntryId(entry.id);
    setDelEditForm({
      breakfastCount: String(entry.breakfastCount),
      lunchCount: String(entry.lunchCount),
      morningSpecial: String(entry.morningSpecial),
      lunchSpecial: String(entry.lunchSpecial),
      deposit: String(entry.deposit),
      depositDate: entry.depositDate || '',
    });
  };

  const handleDelSaveEdit = async () => {
    if (!editingEntryId) return;
    setDelEditLoading(true);
    try {
      const res = await fetch('/api/entries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingEntryId,
          breakfastCount: bnToEn(delEditForm.breakfastCount || '0'),
          lunchCount: bnToEn(delEditForm.lunchCount || '0'),
          morningSpecial: bnToEn(delEditForm.morningSpecial || '0'),
          lunchSpecial: bnToEn(delEditForm.lunchSpecial || '0'),
          deposit: bnToEn(delEditForm.deposit || '0'),
          depositDate: delEditForm.depositDate || '',
        })
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'আপডেট হয়েছে', description: data.message, variant: 'success' });
        setEditingEntryId(null);
        setDelEditForm({});
        handleDelSearch(delSearchPage); // refresh table
        fetchAmoOrders(); fetchEntries(); dispatchMealDataChanged();
      } else {
        toast({ title: 'এরর', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'এরর', variant: 'destructive' });
    } finally {
      setDelEditLoading(false);
    }
  };

  const handleDelDeleteEntry = async (id: string, officeId: string) => {
    setConfirmDialog({
      open: true,
      message: 'এই এন্ট্রি ডিলিট করতে চান?',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/entries?id=${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            toast({ title: 'ডিলিট হয়েছে', description: data.message, variant: 'success' });
            handleDelSearch(delSearchPage);
            // অটো রিফ্রেশ — সব জায়গায় আপডেট
            fetchAmoOrders(); fetchEntries(); dispatchMealDataChanged();
          } else {
            toast({ title: 'এরর', description: data.error, variant: 'destructive' });
          }
        } catch {
          toast({ title: 'এরর', variant: 'destructive' });
        }
      }
    });
  };

  // ===== Delete Dialog: Tab 2 - বছরভিত্তিক ডিলিট =====
  const handleDelYearPreview = async () => {
    if (!delYearQuery.trim() || !delYearYear) {
      toast({ title: 'তথ্য সম্পূর্ণ দিন', description: 'আইডি/মোবাইল এবং বছর দিন', variant: 'destructive' });
      return;
    }
    setDelYearPreviewLoading(true);
    setDelYearPreview(null);
    try {
      const params = new URLSearchParams({
        action: 'preview_year_delete',
        delQuery: bnToEn(delYearQuery.trim()),
        delYear: delYearYear,
      });
      const res = await fetch(`/api/entries?${params}`);
      const data = await res.json();
      if (data.success) {
        setDelYearPreview(data);
      } else {
        toast({ title: 'এরর', description: data.error, variant: 'destructive' });
        setDelYearPreview(null);
      }
    } catch {
      toast({ title: 'এরর', variant: 'destructive' });
      setDelYearPreview(null);
    } finally {
      setDelYearPreviewLoading(false);
    }
  };

  const handleDelYearDelete = async () => {
    if (!delYearQuery.trim() || !delYearYear || !delYearPreview) return;
    // প্রথমে পাসওয়ার্ড ভেরিফিকেশন স্টেপ দেখান
    setDelYearPasswordStep(true);
    setDelYearPassword('');
    setDelYearPasswordError('');
  };

  // ===== Year Delete: Password Verify =====
  const handleDelYearPasswordVerify = async () => {
    if (!delYearPassword.trim()) {
      setDelYearPasswordError('পাসওয়ার্ড দিন');
      return;
    }
    try {
      const verifyRes = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify_password', password: delYearPassword }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyData.success) {
        setDelYearPasswordError(verifyData.error || 'ভুল পাসওয়ার্ড!');
        return;
      }
      if (verifyData.token) sessionStorage.setItem('adminToken', verifyData.token);
    } catch {
      setDelYearPasswordError('ভেরিফিকেশন ব্যর্থ');
      return;
    }
    // পাসওয়ার্ড সঠিক, এখন ডিলিট করুন
    setDelYearDeleteLoading(true);
    try {
      const params = new URLSearchParams({
        action: 'delete_year_member',
        delQuery: bnToEn(delYearQuery.trim()),
        delYear: delYearYear,
      });
      const res = await fetch(`/api/entries?${params}`, {
        method: 'DELETE',
        headers: {
          'x-admin-token': getAdminToken() || '',
          'x-admin-password': delYearPassword,
        }
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'ডিলিট হয়েছে', description: data.message, variant: 'success' });
        setDelYearPreview(null);
        setDelYearQuery('');
        setDelYearYear(currentYear);
        // অটো রিফ্রেশ — সব জায়গায় আপডেট
        fetchAmoOrders(); fetchEntries(); dispatchMealDataChanged();
      } else {
        toast({ title: 'এরর', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'এরর', variant: 'destructive' });
    } finally {
      setDelYearDeleteLoading(false);
      setDelYearPasswordStep(false);
      setDelYearPassword('');
    }
  };

  // ===== Delete dialog open/close — reset state =====
  const handleDeleteDbOpen = (open: boolean) => {
    setDeleteDbOpen(open);
    if (open) {
      setDeleteTab('edit');
      setDelSearchQuery('');
      setDelSearchMonth('');
      setDelSearchYear(currentYear);
      setDelSearchResults([]);
      setDelSearchTotal(0);
      setDelSearchPage(1);
      setDelSearchTotalPages(1);
      setDelSearchHasSearched(false);
      setEditingEntryId(null);
      setDelEditForm({});
      setDelYearQuery('');
      setDelYearYear(currentYear);
      setDelYearPreview(null);
      // Year Delete password reset
      setDelYearPasswordStep(false);
      setDelYearPassword('');
      setDelYearPasswordError('');
      // All Delete state reset
      setAllDeletePasswordStep(false);
      setAllDeletePassword('');
      setAllDeletePasswordError('');
      setAllDeleteVerified(false);
      setAllDeleteLoading(false);
    }
  };

  // ===== All Delete: Admin Password Verify (same as header Admin password) =====
  const handleAllDeletePasswordVerify = async () => {
    if (!allDeletePassword.trim()) {
      setAllDeletePasswordError('পাসওয়ার্ড দিন');
      return;
    }
    try {
      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify_password', password: allDeletePassword }),
      });
      const data = await res.json();
      if (data.success) {
        setAllDeletePasswordError('');
        setAllDeleteVerified(true);
        // Admin token save করুন যাতে delete_all API তে admin auth পাস হয়
        if (data.token) sessionStorage.setItem('adminToken', data.token);
      } else {
        setAllDeletePasswordError(data.error || 'ভুল পাসওয়ার্ড!');
      }
    } catch {
      setAllDeletePasswordError('সার্ভারে সমস্যা হয়েছে');
    }
  };

  // ===== All Delete: Execute =====
  const handleAllDeleteExecute = async () => {
    setAllDeleteLoading(true);
    try {
      const res = await fetch('/api/entries?action=delete_all', {
        method: 'DELETE',
        headers: {
          'x-admin-token': getAdminToken() || '',
          'x-admin-password': allDeletePassword || '',
        }
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'ডিলিট সম্পন্ন', description: data.message, variant: 'success' });
        handleDeleteDbOpen(false);
        setBalanceLoaded(false);
        setAllDeleteVerified(false);
        setAllDeletePassword('');
        setAllDeletePasswordError('');
        // অটো রিফ্রেশ — সব জায়গায় আপডেট
        fetchAmoOrders(); fetchEntries(); dispatchMealDataChanged();
      } else {
        toast({ title: 'এরর', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'এরর', description: 'ডাটাবেজ ডিলিট ব্যর্থ', variant: 'destructive' });
    } finally {
      setAllDeleteLoading(false);
    }
  };

  // ===== Load balance data when needed =====
  useEffect(() => {
    if (!balanceLoaded) {
      fetchAllForBalance();
    }
  }, [balanceLoaded, fetchAllForBalance]);

  // ===== Panel buttons config — গ্রুপ ও স্বাধীন বাটন =====
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ meal: true, deposit: false, market: false });
  const toggleGroup = (g: string) => {
    setOpenGroups(prev => {
      const isOpening = !prev[g];
      return { meal: false, deposit: false, market: false, [g]: isOpening };
    });
    // গ্রুপ খোলার সময় সর্বদা প্রথম ট্যাব সিলেক্ট করুন
    const group = panelGroups.find(pg => pg.key === g);
    if (group) setActivePanel(group.items[0].key);
  };

  const panelGroups = [
    {
      key: 'meal', label: 'মিল', icon: UtensilsCrossed,
      btnColor: 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600',
      openColor: 'bg-emerald-700 text-white border-emerald-700',
      items: [
        { key: 'adminMealOrder', label: 'মিল অর্ডার', icon: ShoppingCart },
        { key: 'rannaPanel', label: 'স্পেশাল মিল চালু', icon: Flame },
        { key: 'mealEntry', label: 'মিল এন্ট্রি', icon: UtensilsCrossed },
        { key: 'priceSettings', label: 'প্রাইস সেটিংস', icon: Settings },
        { key: 'monthlyMealTotal', label: 'মোট মিল', icon: BarChart3 },
      ],
    },
    {
      key: 'deposit', label: 'জমা/বকেয়া/অগ্রিম', icon: Wallet,
      btnColor: 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600',
      openColor: 'bg-emerald-700 text-white border-emerald-700',
      items: [
        { key: 'depositEntry', label: 'টাকা জমা এন্ট্রি', icon: Wallet },
        { key: 'dueAmounts', label: 'বকেয়া টাকা', icon: AlertTriangle },
        { key: 'advanceAmounts', label: 'অগ্রিম টাকা', icon: CheckCircle },
      ],
    },
    {
      key: 'market', label: 'বাজার খরচ', icon: ShoppingBag,
      btnColor: 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600',
      openColor: 'bg-emerald-700 text-white border-emerald-700',
      items: [
        { key: 'marketExpense', label: 'বাজার খরচ', icon: ShoppingCart },
      ],
      directOpen: true as const,
    },
  ];

  const filteredDueEmployees = balanceEmployees
    .filter(e => e.curBalance < 0)
    .filter(e => !balanceFilter || e.officeId.includes(balanceFilter) || e.name.includes(balanceFilter) || e.mobile.includes(balanceFilter));

  const filteredAdvanceEmployees = balanceEmployees
    .filter(e => e.curBalance > 0)
    .filter(e => !balanceFilter || e.officeId.includes(balanceFilter) || e.name.includes(balanceFilter) || e.mobile.includes(balanceFilter));

  return (
    <div className="space-y-4">
      {/* Admin Panel Header */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setCsvOpen(true)} className="gap-1 text-xs">
          <Download className="h-3 w-3" /> CSV ডাউনলোড
        </Button>
        <Button variant="outline" size="sm" onClick={() => { setMemberImportOpen(true); setMemberImportStep('url'); setMemberImportPreview(null); setMemberImportResult(null); setMemberImportSheets([]); setMemberImportSelectedSheet(''); setMemberColumnMap({}); }} className="gap-1 text-xs border-blue-300 text-blue-700 hover:bg-blue-50">
          <Users className="h-3 w-3" />
          সদস্য ইমপোর্ট
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDeleteDbOpen(true)} className="gap-1 text-xs border-purple-300 text-purple-700 hover:bg-purple-50">
          <Database className="h-3 w-3" /> ডাটাবেজ
        </Button>
      </div>

      {/* Panel Buttons — গ্রুপ বাটন (TabsList+TabsTrigger স্টাইল, একই লাইনে) */}
      <div>
        {/* গ্রুপ বাটন — একই লাইনে */}
        <div className="flex items-center gap-2">
          {panelGroups.map(group => {
            const isOpen = openGroups[group.key];
            const hasActive = group.items.some(i => activePanel === i.key);
            return (
              <Button
                key={group.key}
                variant="outline" size="sm"
                onClick={() => toggleGroup(group.key)}
                className={`gap-1 text-xs ${isOpen ? group.openColor : hasActive ? group.btnColor : group.btnColor}`}
              >
                <group.icon className="h-3 w-3" />
                {group.label}
              </Button>
            );
          })}
        </div>
        {/* সাব ট্যাব প্যানেল */}
        {panelGroups.map(group => {
          const isOpen = openGroups[group.key];
          if (!isOpen) return null;
          // directOpen গ্রুপের জন্য ট্যাব লিস্ট দেখাবেনা
          if ((group as any).directOpen) return null;
          const groupActiveValue = group.items.some(i => activePanel === i.key) ? activePanel : group.items[0].key;
          return (
            <Tabs key={group.key} value={groupActiveValue} onValueChange={(v) => setActivePanel(v)}>
              <TabsList className="flex w-full mt-1.5 bg-slate-200 p-0.5 gap-0.5">
                {group.items.map(item => {
                  const isActive = groupActiveValue === item.key;
                  const activeBg = 'data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:border-emerald-700';
                  return (
                    <TabsTrigger key={item.key} value={item.key} className={`flex-1 min-w-0 text-[9px] sm:text-[11px] gap-0.5 rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm data-[state=active]:shadow-md truncate px-1 py-1 ${activeBg}`}>
                      <item.icon className="h-3 w-3 shrink-0" />
                      {item.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          );
        })}
      </div>

      {/* ===== Admin মিল অর্ডার Panel ===== */}
      {activePanel === 'adminMealOrder' && (
        <Card className="shadow-md border-0">
          <CardHeader className="pb-3 bg-emerald-50 rounded-t-lg">
            <CardTitle className="text-lg flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-emerald-600" />Admin — মিল অর্ডার
            </CardTitle>
            <CardDescription>যে কোন সদস্যের জন্য মিল অর্ডার করুন</CardDescription>
          </CardHeader>
          <CardContent className="pt-3 space-y-3">
            {/* তারিখ */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-600 whitespace-nowrap">অর্ডার তারিখ:</label>
              <Input type="date" className="h-8 text-sm" value={amoOrderDate} onChange={e => setAmoOrderDate(e.target.value)} />
            </div>

            {/* নাম/মোবাইল সার্চ */}
            <div className="relative">
              <label className="text-xs font-medium text-slate-600 mb-1 block">নাম / মোবাইল নম্বর</label>
              <Input
                placeholder="নাম, আইডি বা মোবাইল লিখুন"
                className="h-9"
                value={amoQuery}
                onChange={e => handleAmoSuggest(e.target.value)}
                onFocus={() => amoSuggestions.length > 0 && setAmoSuggestOpen(true)}
                onBlur={() => setTimeout(() => setAmoSuggestOpen(false), 200)}
              />
              {/* Dropdown suggestions */}
              {amoSuggestOpen && amoSuggestions.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {amoSuggestions.map((u, i) => (
                    <button
                      key={i}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2 border-b last:border-b-0"
                      onMouseDown={() => handleAmoSelectUser(u)}
                    >
                      <span className="font-medium">{u.name}</span>
                      {u.designation && <span className="text-slate-500 text-xs">{u.designation}</span>}
                      <span className="text-slate-400 text-xs">{u.officeId}</span>
                      {u.mobile && <span className="text-slate-400 text-xs ml-auto">{u.mobile}</span>}
                    </button>
                  ))}
                </div>
              )}
              {amoNotFound && !amoSuggestOpen && !amoSelectedUser && <p className="text-[10px] text-red-500 mt-0.5">ডাটাবেজে পাওয়া যাইনি</p>}
            </div>

            {/* সিলেক্টেড ইউজার দেখান */}
            {amoSelectedUser && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-start gap-2">
                <CheckCircle className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-emerald-800">{amoSelectedUser.name}</p>
                  <p className="text-xs text-emerald-600">আইডি: {amoSelectedUser.officeId} {amoSelectedUser.designation ? `• পদবী: ${amoSelectedUser.designation}` : ''}</p>
                  {amoSelectedUser.mobile && <p className="text-xs text-emerald-600">মোবাইল: {amoSelectedUser.mobile}</p>}
                </div>
              </div>
            )}

            {/* মিল সিলেক্ট — +/- কাউন্টার */}
            <div className="grid grid-cols-2 sm:grid-cols-2 gap-2">
              {[
                { label: 'সকাল নাস্তা', count: amoBreakfast, setCount: setAmoBreakfast, color: 'emerald' },
                { label: 'দুপুর মিল', count: amoLunch, setCount: setAmoLunch, color: 'blue' },
                { label: 'সকাল স্পেশাল', count: amoMorningSpecial, setCount: setAmoMorningSpecial, color: 'orange' },
                { label: 'দুপুর স্পেশাল', count: amoLunchSpecial, setCount: setAmoLunchSpecial, color: 'amber' },
              ].map(item => {
                const isActive = item.count > 0;
                const displayCount = item.count > 0 ? item.count : 1;
                const bgClass = isActive
                  ? item.color === 'emerald' ? 'bg-emerald-500 text-white border-emerald-500' :
                    item.color === 'blue' ? 'bg-blue-500 text-white border-blue-500' :
                    item.color === 'orange' ? 'bg-orange-500 text-white border-orange-500' :
                    'bg-amber-500 text-white border-amber-500'
                  : 'bg-white text-slate-500 border-slate-300';
                const btnClass = item.color === 'emerald' ? 'hover:bg-emerald-600' :
                  item.color === 'blue' ? 'hover:bg-blue-600' :
                  item.color === 'orange' ? 'hover:bg-orange-600' : 'hover:bg-amber-600';
                return (
                  <div key={item.label} className="flex items-stretch">
                    {/* +/- বাটন বাম পাশে */}
                    <div className="flex flex-col">
                      <button onClick={() => item.setCount(item.count + 1)} className="w-7 h-[50%] rounded-tl-lg flex items-center justify-center text-sm font-bold border-2 border-b-0 border-r-0 border-slate-300 bg-slate-100 text-emerald-600 hover:bg-emerald-100 transition-colors">+</button>
                      <button onClick={() => item.setCount(Math.max(0, item.count - 1))} className="w-7 h-[50%] rounded-bl-lg flex items-center justify-center text-sm font-bold border-2 border-r-0 border-slate-300 bg-slate-100 text-red-500 hover:bg-red-100 transition-colors">−</button>
                    </div>
                    {/* নাম বক্স */}
                    <div onClick={() => { item.setCount(item.count > 0 ? 0 : 1); }} className={`flex-1 rounded-tr-lg rounded-br-lg border-2 px-2.5 py-2 text-center cursor-pointer transition-all min-w-[80px] ${isActive ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
                      <span className="text-xs font-bold">{item.label}{item.count > 0 ? ` +${item.count} টি` : ''}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* সেভ বাটন */}
            <Button onClick={handleAmoSave} disabled={amoSaving || !amoSelectedUser || (!amoBreakfast && !amoLunch && !amoMorningSpecial && !amoLunchSpecial)} className="w-full bg-emerald-600 hover:bg-emerald-700 gap-2">
              {amoSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              সেভ করুন
            </Button>

            {/* আজকের অর্ডার লিস্ট — ড্রপডাউন (সিলেক্টেড ইউজার ফিল্টার) */}
            {amoOrderDate && (() => {
              // সিলেক্টেড ইউজার থাকলে শুধু তার অর্ডার দেখাবে, না থাকলে সব
              const filteredOrders = amoSelectedUser ? amoOrders.filter((o: any) => o.officeId === amoSelectedUser.officeId) : amoOrders;
              const totalBreakfast = filteredOrders.reduce((s: number, o: any) => s + (Number(o.breakfast) || 0), 0);
              const totalLunch = filteredOrders.reduce((s: number, o: any) => s + (Number(o.lunch) || 0), 0);
              const totalMS = filteredOrders.reduce((s: number, o: any) => s + (Number(o.morningSpecial) || 0), 0);
              const totalLS = filteredOrders.reduce((s: number, o: any) => s + (Number(o.lunchSpecial) || 0), 0);
              return (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-600">মোট অর্ডার: {filteredOrders.length} টি{amoSelectedUser ? ` (${amoSelectedUser.name})` : ''}</p>
                  <Button variant="ghost" size="sm" onClick={fetchAmoOrders} className="text-xs gap-1">
                    <RefreshCw className="h-3 w-3" /> রিফ্রেশ
                  </Button>
                </div>
                {/* বিভাগ অনুযায়ী অর্ডার কাউন্ট */}
                {filteredOrders.length > 0 && (
                  <div className="grid grid-cols-4 gap-1">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1.5 text-center">
                      <p className="text-[10px] text-emerald-600">সকাল নাস্তা</p>
                      <p className="text-sm font-bold text-emerald-700">{totalBreakfast}</p>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-md px-2 py-1.5 text-center">
                      <p className="text-[10px] text-blue-600">দুপুর মিল</p>
                      <p className="text-sm font-bold text-blue-700">{totalLunch}</p>
                    </div>
                    <div className="bg-orange-50 border border-orange-200 rounded-md px-2 py-1.5 text-center">
                      <p className="text-[10px] text-orange-600">সঃ স্পেশাল</p>
                      <p className="text-sm font-bold text-orange-700">{totalMS}</p>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 text-center">
                      <p className="text-[10px] text-amber-600">দঃ স্পেশাল</p>
                      <p className="text-sm font-bold text-amber-700">{totalLS}</p>
                    </div>
                  </div>
                )}
                {filteredOrders.length > 0 && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setAmoListOpen(!amoListOpen)}
                      className="w-full flex items-center justify-between px-3 py-2 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors"
                    >
                      <span>অর্ডার তালিকা দেখুন ({filteredOrders.length} টি){amoSelectedUser ? ` — ${amoSelectedUser.name}` : ''}</span>
                      {amoListOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    {amoListOpen && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 border border-slate-200 rounded-lg bg-white shadow-xl max-h-60 overflow-y-auto">
                        <div className="sticky top-0 bg-slate-50 border-b border-slate-200 px-2 py-1 flex items-center gap-1 text-[10px] font-medium text-slate-500">
                          <span className="flex-[2] min-w-0">নাম / পদবী / মোবাইল</span>
                          <span className="w-8 text-center">সকাল</span>
                          <span className="w-8 text-center">দুপুর</span>
                          <span className="w-8 text-center">সঃস্পে</span>
                          <span className="w-8 text-center">দঃস্পে</span>
                          <span className="w-12 text-center">অ্যাকশন</span>
                        </div>
                        {filteredOrders.map((order: any, idx: number) => (
                          amoEditOrder && amoEditOrder.officeId === order.officeId ? (
                            <div key={idx} className="flex items-center gap-1 px-2 py-1.5 border-b border-emerald-200 bg-emerald-50">
                              <div className="flex-[2] min-w-0">
                                <p className="text-[11px] font-medium text-emerald-700 truncate">{order.name}</p>
                                <p className="text-[9px] text-emerald-500 truncate">{order.designation || ''}{order.designation && order.mobile ? ' • ' : ''}{order.mobile ? (typeof formatMobile === 'function' ? formatMobile(order.mobile) : order.mobile) : ''}</p>
                              </div>
                              {['breakfast','lunch','morningSpecial','lunchSpecial'].map((field) => (
                                <div key={field} className="flex items-center justify-center gap-0 w-8">
                                  <button onClick={() => handleAmoEditCount(field, -1)} className="w-4 h-4 rounded bg-red-100 text-red-600 text-[9px] font-bold hover:bg-red-200 leading-none">−</button>
                                  <span className="w-4 text-center font-bold text-[10px]">{amoEditOrder[field] || 0}</span>
                                  <button onClick={() => handleAmoEditCount(field, 1)} className="w-4 h-4 rounded bg-emerald-100 text-emerald-600 text-[9px] font-bold hover:bg-emerald-200 leading-none">+</button>
                                </div>
                              ))}
                              <div className="flex items-center justify-center gap-0.5 w-12">
                                <button onClick={handleAmoEditSave} disabled={amoEditSaving} className="text-emerald-600 hover:bg-emerald-100 rounded p-0.5">
                                  {amoEditSaving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <CheckCircle className="h-2.5 w-2.5" />}
                                </button>
                                <button onClick={() => setAmoEditOrder(null)} className="text-slate-400 hover:bg-slate-100 rounded p-0.5">
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div key={idx} className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-100 hover:bg-slate-50">
                              <div className="flex-[2] min-w-0">
                                <p className="text-[11px] font-medium truncate">{order.name}</p>
                                <p className="text-[9px] text-slate-400 truncate">{order.designation || ''}{order.designation && order.mobile ? ' • ' : ''}{order.mobile ? (typeof formatMobile === 'function' ? formatMobile(order.mobile) : order.mobile) : ''}</p>
                              </div>
                              <span className="w-8 text-center text-[10px]">{order.breakfast > 0 ? <span className="inline-flex items-center justify-center w-4 h-4 bg-emerald-100 text-emerald-700 font-bold rounded-full text-[9px]">{order.breakfast}</span> : '—'}</span>
                              <span className="w-8 text-center text-[10px]">{order.lunch > 0 ? <span className="inline-flex items-center justify-center w-4 h-4 bg-blue-100 text-blue-700 font-bold rounded-full text-[9px]">{order.lunch}</span> : '—'}</span>
                              <span className="w-8 text-center text-[10px]">{order.morningSpecial > 0 ? <span className="inline-flex items-center justify-center w-4 h-4 bg-orange-100 text-orange-700 font-bold rounded-full text-[9px]">{order.morningSpecial}</span> : '—'}</span>
                              <span className="w-8 text-center text-[10px]">{order.lunchSpecial > 0 ? <span className="inline-flex items-center justify-center w-4 h-4 bg-amber-100 text-amber-700 font-bold rounded-full text-[9px]">{order.lunchSpecial}</span> : '—'}</span>
                              <div className="flex items-center justify-center gap-0.5 w-12">
                                <button onClick={() => setAmoEditOrder({...order})} className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded p-0.5" title="এডিট">
                                  <Pencil className="h-2.5 w-2.5" />
                                </button>
                                <button onClick={() => handleAmoDeleteOrder(order.officeId)} className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded p-0.5" title="ডিলিট">
                                  <Trash2 className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            </div>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* ===== মিল এন্ট্রি Panel ===== */}
      {activePanel === 'mealEntry' && (
        <Card className="shadow-md border-0">
          <CardHeader className="pb-3 bg-emerald-50 rounded-t-lg">
            <CardTitle className="text-lg flex items-center gap-2">
              <UtensilsCrossed className="h-5 w-5 text-emerald-600" />টোটাল মিল এন্ট্রি
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 space-y-2">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              {/* 1. অফিস আইডি */}
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">অফিস আইডি</label>
                <div className="relative">
                  <Input placeholder="আইডি" value={mealForm.officeId || ''} onChange={e => handleMealFormChange('officeId', e.target.value)} onBlur={() => handleMealFieldBlur('officeId')} className="h-8 text-sm" />
                  {mealLookupLoading && <Loader2 className="h-3 w-3 animate-spin absolute right-1.5 top-2 text-slate-400" />}
                  {mealSuggestOpen && mealSuggestions.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                      {mealSuggestions.map((u, i) => (
                        <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                          onMouseDown={e => { e.preventDefault(); selectSuggestion(u, setMealForm, setMealSuggestions, setMealSuggestOpen, setMealLookupResult); }}>
                          {mealSuggestField === 'officeId' ? (
                            <><span className="font-bold text-emerald-700">{u.officeId}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : mealSuggestField === 'name' ? (
                            <><span className="font-bold text-emerald-700">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : mealSuggestField === 'mobile' ? (
                            <><span className="font-bold text-emerald-700">{formatMobile(u.mobile)}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-1">{u.officeId}</span></>
                          ) : mealSuggestField === 'designation' ? (
                            <><span className="font-bold text-emerald-700">{u.designation}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span><span className="text-slate-400 ml-1">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : (
                            <><span className="font-medium text-slate-800">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {!mealLookupLoading && mealLookupResult?.officeId === '__not_found__' && <p className="text-[10px] text-red-500 mt-0.5">ডাটাবেজে পাওয়া যাইনি</p>}
                </div>
              </div>
              {/* 2. নাম */}
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">নাম</label>
                <div className="relative">
                  <Input placeholder="নাম" value={mealForm.name || ''} onChange={e => handleMealFormChange('name', e.target.value)} onBlur={() => handleMealFieldBlur('name')} className="h-8 text-sm" />
                  {mealLookupLoading && <Loader2 className="h-3 w-3 animate-spin absolute right-1.5 top-2 text-slate-400" />}
                  {mealSuggestOpen && mealSuggestions.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                      {mealSuggestions.map((u, i) => (
                        <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                          onMouseDown={e => { e.preventDefault(); selectSuggestion(u, setMealForm, setMealSuggestions, setMealSuggestOpen, setMealLookupResult); }}>
                          {mealSuggestField === 'officeId' ? (
                            <><span className="font-bold text-emerald-700">{u.officeId}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : mealSuggestField === 'name' ? (
                            <><span className="font-bold text-emerald-700">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : mealSuggestField === 'mobile' ? (
                            <><span className="font-bold text-emerald-700">{formatMobile(u.mobile)}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-1">{u.officeId}</span></>
                          ) : mealSuggestField === 'designation' ? (
                            <><span className="font-bold text-emerald-700">{u.designation}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span><span className="text-slate-400 ml-1">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : (
                            <><span className="font-medium text-slate-800">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {!mealLookupLoading && mealLookupResult?.officeId === '__not_found__' && <p className="text-[10px] text-red-500 mt-0.5">ডাটাবেজে পাওয়া যাইনি</p>}
                </div>
              </div>
              {/* 3. পদবী */}
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">পদবী</label>
                <div className="relative">
                  <Input value={mealForm.designation || ''} onChange={e => handleMealFormChange('designation', e.target.value)} onBlur={() => setMealSuggestOpen(false)} className="h-8 text-sm" />
                  {mealSuggestOpen && mealSuggestField === 'designation' && mealSuggestions.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                      {mealSuggestions.map((u, i) => (
                        <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                          onMouseDown={e => { e.preventDefault(); selectSuggestion(u, setMealForm, setMealSuggestions, setMealSuggestOpen, setMealLookupResult); }}>
                          <span className="font-bold text-emerald-700">{u.designation}</span>
                          <span className="font-medium text-slate-800 ml-2">{u.name}</span>
                          <span className="text-slate-400 ml-1">{u.officeId}</span>
                          {u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* 4. মোবাইল */}
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">মোবাইল</label>
                <div className="relative">
                  <Input placeholder="মোবাইল" value={mealForm.mobile || ''} onChange={e => handleMealFormChange('mobile', e.target.value)} onBlur={() => handleMealFieldBlur('mobile')} className="h-8 text-sm" />
                  {mealLookupLoading && <Loader2 className="h-3 w-3 animate-spin absolute right-1.5 top-2 text-slate-400" />}
                  {mealSuggestOpen && mealSuggestions.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                      {mealSuggestions.map((u, i) => (
                        <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                          onMouseDown={e => { e.preventDefault(); selectSuggestion(u, setMealForm, setMealSuggestions, setMealSuggestOpen, setMealLookupResult); }}>
                          {mealSuggestField === 'officeId' ? (
                            <><span className="font-bold text-emerald-700">{u.officeId}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : mealSuggestField === 'name' ? (
                            <><span className="font-bold text-emerald-700">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : mealSuggestField === 'mobile' ? (
                            <><span className="font-bold text-emerald-700">{formatMobile(u.mobile)}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-1">{u.officeId}</span></>
                          ) : mealSuggestField === 'designation' ? (
                            <><span className="font-bold text-emerald-700">{u.designation}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span><span className="text-slate-400 ml-1">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : (
                            <><span className="font-medium text-slate-800">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {!mealLookupLoading && mealLookupResult?.officeId === '__not_found__' && <p className="text-[10px] text-red-500 mt-0.5">ডাটাবেজে পাওয়া যাইনি</p>}
                </div>
              </div>
              {/* 5. মাস */}
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">মাস *</label>
                <Select value={mealForm.month} onValueChange={v => setMealForm(prev => ({ ...prev, month: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="মাস" /></SelectTrigger>
                  <SelectContent>{MONTHS_NO_ALL.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {/* 6. বছর */}
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">বছর *</label>
                <Input type="number" placeholder="2026" value={mealForm.year || ''} onChange={e => setMealForm(prev => ({ ...prev, year: e.target.value }))} className="h-8 text-sm" />
              </div>
              {/* 7. তারিখ */}
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">তারিখ</label>
                <Input type="date" value={mealForm.entryDate || ''} onChange={e => setMealForm(prev => ({ ...prev, entryDate: e.target.value }))} className="h-8 text-sm" />
              </div>
            </div>
            {mealLookupResult && mealLookupResult.officeId !== '__not_found__' && (
              <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded">
                <CheckCircle className="h-3 w-3 text-emerald-600 shrink-0" />
                <span className="text-[10px] text-emerald-700">
                  {mealLookupResult.name}{mealLookupResult.designation ? ` [${mealLookupResult.designation}]` : ''}{mealLookupResult.officeId ? ` — ${mealLookupResult.officeId}` : ''}{mealLookupResult.mobile ? ` (${formatMobile(mealLookupResult.mobile)})` : ''}
                </span>
              </div>
            )}
            <div className="grid grid-cols-4 gap-2">
              {[
                { key: 'breakfastCount', label: 'সকাল নাস্তা' },
                { key: 'lunchCount', label: 'দুপুর মিল' },
                { key: 'morningSpecial', label: 'সকাল স্পেশাল' },
                { key: 'lunchSpecial', label: 'দুপুর স্পেশাল' },
              ].map(f => (
                <div key={f.key} className="space-y-0.5">
                  <label className="text-[10px] font-medium text-slate-500">{f.label}</label>
                  <Input type="number" className="h-8 text-sm" value={mealForm[f.key] || '0'} onChange={e => setMealForm(prev => ({ ...prev, [f.key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <Button onClick={handleMealSave} disabled={mealSaving} className="w-full h-8 bg-emerald-600 hover:bg-emerald-700 gap-1 text-sm">
              {mealSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              সেভ করুন
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ===== টাকা জমা এন্ট্রি Panel ===== */}
      {activePanel === 'depositEntry' && (
        <Card className="shadow-md border-0">
          <CardHeader className="pb-3 bg-emerald-50 rounded-t-lg">
            <CardTitle className="text-lg flex items-center gap-2">
              <Wallet className="h-5 w-5 text-emerald-600" />টাকা জমা এন্ট্রি
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 space-y-1.5">
            {/* Row 1: অফিস আইডি | নাম | পদবী | মোবাইল | মাস | বছর */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-1.5">
              {/* 1. অফিস আইডি */}
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">অফিস আইডি</label>
                <div className="relative">
                  <Input placeholder="আইডি" value={depositForm.officeId || ''} onChange={e => handleDepositFormChange('officeId', e.target.value)} onBlur={() => handleDepositFieldBlur('officeId')} className="h-7 text-sm" />
                  {depositLookupLoading && <Loader2 className="h-3 w-3 animate-spin absolute right-1 top-1.5 text-slate-400" />}
                  {depositSuggestOpen && depositSuggestions.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                      {depositSuggestions.map((u, i) => (
                        <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                          onMouseDown={e => { e.preventDefault(); selectSuggestion(u, setDepositForm, setDepositSuggestions, setDepositSuggestOpen, setDepositLookupResult); }}>
                          {depositSuggestField === 'officeId' ? (
                            <><span className="font-bold text-emerald-700">{u.officeId}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : depositSuggestField === 'name' ? (
                            <><span className="font-bold text-emerald-700">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : depositSuggestField === 'mobile' ? (
                            <><span className="font-bold text-emerald-700">{formatMobile(u.mobile)}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-1">{u.officeId}</span></>
                          ) : depositSuggestField === 'designation' ? (
                            <><span className="font-bold text-emerald-700">{u.designation}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span><span className="text-slate-400 ml-1">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : (
                            <><span className="font-medium text-slate-800">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {!depositLookupLoading && depositLookupResult?.officeId === '__not_found__' && <p className="text-[10px] text-red-500 mt-0.5">ডাটাবেজে পাওয়া যাইনি</p>}
                </div>
              </div>
              {/* 2. নাম */}
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">নাম</label>
                <div className="relative">
                  <Input placeholder="নাম" value={depositForm.name || ''} onChange={e => handleDepositFormChange('name', e.target.value)} onBlur={() => handleDepositFieldBlur('name')} className="h-7 text-sm" />
                  {depositLookupLoading && <Loader2 className="h-3 w-3 animate-spin absolute right-1 top-1.5 text-slate-400" />}
                  {depositSuggestOpen && depositSuggestions.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                      {depositSuggestions.map((u, i) => (
                        <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                          onMouseDown={e => { e.preventDefault(); selectSuggestion(u, setDepositForm, setDepositSuggestions, setDepositSuggestOpen, setDepositLookupResult); }}>
                          {depositSuggestField === 'officeId' ? (
                            <><span className="font-bold text-emerald-700">{u.officeId}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : depositSuggestField === 'name' ? (
                            <><span className="font-bold text-emerald-700">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : depositSuggestField === 'mobile' ? (
                            <><span className="font-bold text-emerald-700">{formatMobile(u.mobile)}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-1">{u.officeId}</span></>
                          ) : depositSuggestField === 'designation' ? (
                            <><span className="font-bold text-emerald-700">{u.designation}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span><span className="text-slate-400 ml-1">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : (
                            <><span className="font-medium text-slate-800">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {!depositLookupLoading && depositLookupResult?.officeId === '__not_found__' && <p className="text-[10px] text-red-500 mt-0.5">ডাটাবেজে পাওয়া যাইনি</p>}
                </div>
              </div>
              {/* 3. পদবী */}
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">পদবী</label>
                <div className="relative">
                  <Input value={depositForm.designation || ''} onChange={e => handleDepositFormChange('designation', e.target.value)} onBlur={() => setDepositSuggestOpen(false)} className="h-7 text-sm" />
                  {depositSuggestOpen && depositSuggestField === 'designation' && depositSuggestions.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                      {depositSuggestions.map((u, i) => (
                        <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                          onMouseDown={e => { e.preventDefault(); selectSuggestion(u, setDepositForm, setDepositSuggestions, setDepositSuggestOpen, setDepositLookupResult); }}>
                          <span className="font-bold text-emerald-700">{u.designation}</span>
                          <span className="font-medium text-slate-800 ml-2">{u.name}</span>
                          <span className="text-slate-400 ml-1">{u.officeId}</span>
                          {u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* 4. মোবাইল */}
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">মোবাইল</label>
                <div className="relative">
                  <Input placeholder="মোবাইল" value={depositForm.mobile || ''} onChange={e => handleDepositFormChange('mobile', e.target.value)} onBlur={() => handleDepositFieldBlur('mobile')} className="h-7 text-sm" />
                  {depositLookupLoading && <Loader2 className="h-3 w-3 animate-spin absolute right-1 top-1.5 text-slate-400" />}
                  {depositSuggestOpen && depositSuggestions.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                      {depositSuggestions.map((u, i) => (
                        <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                          onMouseDown={e => { e.preventDefault(); selectSuggestion(u, setDepositForm, setDepositSuggestions, setDepositSuggestOpen, setDepositLookupResult); }}>
                          {depositSuggestField === 'officeId' ? (
                            <><span className="font-bold text-emerald-700">{u.officeId}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : depositSuggestField === 'name' ? (
                            <><span className="font-bold text-emerald-700">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : depositSuggestField === 'mobile' ? (
                            <><span className="font-bold text-emerald-700">{formatMobile(u.mobile)}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-1">{u.officeId}</span></>
                          ) : depositSuggestField === 'designation' ? (
                            <><span className="font-bold text-emerald-700">{u.designation}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span><span className="text-slate-400 ml-1">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          ) : (
                            <><span className="font-medium text-slate-800">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {!depositLookupLoading && depositLookupResult?.officeId === '__not_found__' && <p className="text-[10px] text-red-500 mt-0.5">ডাটাবেজে পাওয়া যাইনি</p>}
                </div>
              </div>
              {/* 5. মাস */}
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">মাস *</label>
                <Select value={depositForm.month} onValueChange={v => setDepositForm(prev => ({ ...prev, month: v }))}>
                  <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="মাস" /></SelectTrigger>
                  <SelectContent>{MONTHS_NO_ALL.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {/* 6. বছর */}
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">বছর *</label>
                <Input type="number" placeholder="2026" value={depositForm.year || ''} onChange={e => setDepositForm(prev => ({ ...prev, year: e.target.value }))} className="h-7 text-sm" />
              </div>
            </div>
            {depositLookupResult && depositLookupResult.officeId !== '__not_found__' && (
              <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded">
                <CheckCircle className="h-3 w-3 text-emerald-600 shrink-0" />
                <span className="text-[10px] text-emerald-700">
                  {depositLookupResult.name}{depositLookupResult.designation ? ` [${depositLookupResult.designation}]` : ''}{depositLookupResult.officeId ? ` — ${depositLookupResult.officeId}` : ''}{depositLookupResult.mobile ? ` (${formatMobile(depositLookupResult.mobile)})` : ''}
                </span>
              </div>
            )}

            {/* Deposit Info Display */}
            {depositInfo && depositInfo.success && (
              <div className="space-y-2 p-2 bg-slate-50 rounded-lg border">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[10px] text-slate-500">নাম</p>
                    <p className="text-sm font-bold text-slate-800">{depositInfo.user?.name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500">আইডি</p>
                    <p className="text-sm font-bold text-slate-800">{depositInfo.user?.id}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500">মোবাইল</p>
                    <p className="text-sm font-bold text-slate-800">{formatMobile(depositInfo.user?.mobile || '—')}</p>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-1.5 bg-red-50 rounded">
                    <p className="text-[10px] text-slate-500">মোট বিল</p>
                    <p className="text-sm font-bold text-red-700">{depositInfo.summary?.total_bill || 0}  Tk</p>
                  </div>
                  <div className="p-1.5 bg-emerald-50 rounded">
                    <p className="text-[10px] text-slate-500">মোট জমা</p>
                    <p className="text-sm font-bold text-emerald-700">{depositInfo.summary?.total_deposit || 0}  Tk</p>
                  </div>
                  <div className={`p-1.5 rounded ${depositInfo.latestBalance >= 0 ? 'bg-blue-50' : 'bg-amber-50'}`}>
                    <p className="text-[10px] text-slate-500">ব্যালেন্স</p>
                    <p className={`text-sm font-bold ${depositInfo.latestBalance >= 0 ? 'text-blue-700' : 'text-amber-700'}`}>
                      {depositInfo.latestBalance >= 0 ? '+' : ''}{depositInfo.latestBalance}  Tk
                    </p>
                  </div>
                </div>
              </div>
            )}

            {depositInfo && !depositInfo.success && (
              <div className="p-2 bg-red-50 border border-red-200 rounded">
                <p className="text-red-700 text-center text-xs">{depositInfo.error}</p>
              </div>
            )}

            {/* Row 2: জমার পরিমাণ | জমার তারিখ | তথ্য + সেভ বাটন */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5">
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">জমার পরিমাণ *</label>
                <Input type="number" placeholder="0" value={depositForm.deposit || ''} onChange={e => setDepositForm(prev => ({ ...prev, deposit: e.target.value }))} className="h-7 text-sm" />
              </div>
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium text-slate-500">জমার তারিখ</label>
                <Input type="date" value={depositForm.depositDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })} onChange={e => setDepositForm(prev => ({ ...prev, depositDate: e.target.value }))} className="h-7 text-sm" />
              </div>
              <div className="col-span-2 md:col-span-3 flex items-end gap-1.5">
                <Button onClick={handleDepositLookupInfo} disabled={depositInfoLoading} className="h-7 gap-1 text-xs px-3 bg-blue-600 hover:bg-blue-700 text-white">
                  {depositInfoLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                  তথ্য
                </Button>
                <Button onClick={handleDepositSave} disabled={depositSaving} className="h-7 bg-emerald-600 hover:bg-emerald-700 gap-1 text-xs px-3">
                  {depositSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  সেভ
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== বকেয়া টাকা Panel ===== */}
      {activePanel === 'dueAmounts' && (
        <Card className="shadow-md border-0">
          <CardHeader className="pb-3 bg-red-50 rounded-t-lg">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />বকেয়া টাকা
              {filteredDueEmployees.length > 0 && (
                <>
                  <Badge variant="destructive" className="ml-auto mr-2">{filteredDueEmployees.length} জন</Badge>
                  <Button size="sm" variant="outline" onClick={() => downloadBalanceExcel('due')} className="ml-auto gap-1 text-xs border-red-300 text-red-700 hover:bg-red-100 h-7">
                    <Download className="h-3 w-3" /> ডাউনলোড
                  </Button>
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="flex gap-2">
              <Input placeholder="নাম, আইডি বা মোবাইল দিয়ে খুঁজুন..." value={balanceFilter} onChange={e => setBalanceFilter(e.target.value)} className="h-9 flex-1" />
              {filteredDueEmployees.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => downloadBalanceExcel('due')} className="gap-1 text-xs border-red-300 text-red-700 hover:bg-red-100 h-9 shrink-0">
                  <Download className="h-3 w-3" /> ডাউনলোড
                </Button>
              )}
            </div>
            {balanceLoading ? (
              <div className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-400" /></div>
            ) : filteredDueEmployees.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">কারো বকেয়া নেই</p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-lg border bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="py-2 px-3 text-left">অফিস আইডি</th>
                      <th className="py-2 px-3 text-left">নাম</th>
                      <th className="py-2 px-3 text-left">পদবী</th>
                      <th className="py-2 px-3 text-left">মোবাইল</th>
                      <th className="py-2 px-3 text-right">বকেয়া পরিমাণ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDueEmployees.map((e, i) => (
                      <tr key={i} className="border-t hover:bg-red-50">
                        <td className="py-2 px-3 font-medium">{e.officeId}</td>
                        <td className="py-2 px-3">{e.name || '—'}</td>
                        <td className="py-2 px-3 text-slate-500 text-xs">{(e as any).designation || '—'}</td>
                        <td className="py-2 px-3 text-slate-500">{formatMobile(e.mobile || '—')}</td>
                        <td className="py-2 px-3 text-right font-bold text-red-700">{Math.abs(e.curBalance)} টাকা</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-red-300 bg-red-50 font-bold">
                      <td colSpan={4} className="py-2 px-3 text-right">মোট বকেয়া:</td>
                      <td className="py-2 px-3 text-right text-red-800">{filteredDueEmployees.reduce((s, e) => s + Math.abs(e.curBalance), 0)} টাকা</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== অগ্রিম টাকা Panel ===== */}
      {activePanel === 'advanceAmounts' && (
        <Card className="shadow-md border-0">
          <CardHeader className="pb-3 bg-blue-50 rounded-t-lg">
            <CardTitle className="text-lg flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-blue-600" />অগ্রিম টাকা
              {filteredAdvanceEmployees.length > 0 && (
                <>
                  <Badge className="ml-auto mr-2 bg-blue-200 text-blue-800 hover:bg-blue-200">{filteredAdvanceEmployees.length} জন</Badge>
                  <Button size="sm" variant="outline" onClick={() => downloadBalanceExcel('advance')} className="ml-auto gap-1 text-xs border-blue-300 text-blue-700 hover:bg-blue-100 h-7">
                    <Download className="h-3 w-3" /> ডাউনলোড
                  </Button>
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="flex gap-2">
              <Input placeholder="নাম, আইডি বা মোবাইল দিয়ে খুঁজুন..." value={balanceFilter} onChange={e => setBalanceFilter(e.target.value)} className="h-9 flex-1" />
              {filteredAdvanceEmployees.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => downloadBalanceExcel('advance')} className="gap-1 text-xs border-blue-300 text-blue-700 hover:bg-blue-100 h-9 shrink-0">
                  <Download className="h-3 w-3" /> ডাউনলোড
                </Button>
              )}
            </div>
            {balanceLoading ? (
              <div className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-400" /></div>
            ) : filteredAdvanceEmployees.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">কারো অগ্রিম নেই</p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-lg border bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="py-2 px-3 text-left">অফিস আইডি</th>
                      <th className="py-2 px-3 text-left">নাম</th>
                      <th className="py-2 px-3 text-left">পদবী</th>
                      <th className="py-2 px-3 text-left">মোবাইল</th>
                      <th className="py-2 px-3 text-right">অগ্রিম পরিমাণ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAdvanceEmployees.map((e, i) => (
                      <tr key={i} className="border-t hover:bg-blue-50">
                        <td className="py-2 px-3 font-medium">{e.officeId}</td>
                        <td className="py-2 px-3">{e.name || '—'}</td>
                        <td className="py-2 px-3 text-slate-500 text-xs">{(e as any).designation || '—'}</td>
                        <td className="py-2 px-3 text-slate-500">{formatMobile(e.mobile || '—')}</td>
                        <td className="py-2 px-3 text-right font-bold text-blue-700">{e.curBalance} টাকা</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-blue-300 bg-blue-50 font-bold">
                      <td colSpan={4} className="py-2 px-3 text-right">মোট অগ্রিম:</td>
                      <td className="py-2 px-3 text-right text-blue-800">{filteredAdvanceEmployees.reduce((s, e) => s + e.curBalance, 0)} টাকা</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== মিলের প্রাইস সেটিংস Panel ===== */}
      {activePanel === 'priceSettings' && (
        <>
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm text-slate-500">মাসিক খাবারের দাম</p>
            <Button size="sm" onClick={() => setNewSettingOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 gap-1">
              <Plus className="h-4 w-4" /> নতুন সেটিং
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="py-2 px-3 text-left">মাস</th>
                  <th className="py-2 px-3 text-left">বছর</th>
                  <th className="py-2 px-3 text-center">সকাল নাস্তা</th>
                  <th className="py-2 px-3 text-center">দুপুর মিল</th>
                  <th className="py-2 px-3 text-center">সকাল স্পেশাল</th>
                  <th className="py-2 px-3 text-center">দুপুর স্পেশাল</th>
                  <th className="py-2 px-3 text-center">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {settings.length === 0 ? (
                  <tr><td colSpan={7} className="py-6 text-center text-slate-400">কোনো সেটিংস নেই</td></tr>
                ) : settings.map(s => (
                  <tr key={s.id} className="border-t hover:bg-slate-50">
                    <td className="py-2 px-3 font-medium">{s.month}</td>
                    <td className="py-2 px-3">{s.year}</td>
                    <td className="py-2 px-3 text-center">{s.breakfastPrice || '—'}</td>
                    <td className="py-2 px-3 text-center">{s.lunchPrice || '—'}</td>
                    <td className="py-2 px-3 text-center">{s.morningSpecial || '—'}</td>
                    <td className="py-2 px-3 text-center">{s.lunchSpecial || '—'}</td>
                    <td className="py-2 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => {
                          setEditSetting(s);
                          setSettingForm({
                            breakfastPrice: String(s.breakfastPrice), lunchPrice: String(s.lunchPrice),
                            morningSpecial: String(s.morningSpecial), lunchSpecial: String(s.lunchSpecial)
                          });
                        }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => handleDeleteSetting(s.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ===== বাজার খরচ Panel ===== */}
      {activePanel === 'marketExpense' && (
        <Card className="shadow-md border-0">
          <CardHeader className="pb-3 bg-orange-50 rounded-t-lg">
            <CardTitle className="text-lg flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-orange-600" />বাজার খরচ
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 space-y-4">
            {/* নতুন খরচ যোগ */}
            <div className="bg-slate-50 border rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-slate-700">নতুন খরচ যোগ করুন</p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <div className="space-y-0.5">
                  <label className="text-[10px] font-medium text-slate-500">তারিখ</label>
                  <Input type="date" className="h-8 text-sm" value={marketExpenseForm.expenseDate || ''} onChange={e => setMarketExpenseForm(p => ({ ...p, expenseDate: e.target.value }))} />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] font-medium text-slate-500">মালের বিবরণ</label>
                  <Input placeholder="মালের বিবরণ লিখুন" className="h-8 text-sm" value={marketExpenseForm.description || ''} onChange={e => setMarketExpenseForm(p => ({ ...p, description: e.target.value }))} />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] font-medium text-slate-500">টোটাল খরচ ( Tk)</label>
                  <Input type="number" placeholder="0" className="h-8 text-sm" value={marketExpenseForm.totalCost || ''} onChange={e => setMarketExpenseForm(p => ({ ...p, totalCost: e.target.value }))} />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleMarketExpenseSave} disabled={marketExpenseSaving || !marketExpenseForm.expenseDate} className="w-full h-8 bg-orange-600 hover:bg-orange-700 gap-1 text-sm">
                    {marketExpenseSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    সেভ করুন
                  </Button>
                </div>
              </div>
            </div>

            <Separator />

            {/* মাস ভিত্তিক সার্চ */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">মাস ভিত্তিক খরচ দেখুন</p>
              <div className="flex flex-wrap gap-2">
                <Select value={marketExpenseSearchMonth} onValueChange={setMarketExpenseSearchMonth}>
                  <SelectTrigger className="h-8 w-40 text-sm"><SelectValue placeholder="মাস সিলেক্ট" /></SelectTrigger>
                  <SelectContent>{MONTHS_NO_ALL.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="h-8 w-24 text-sm" placeholder="বছর" value={marketExpenseSearchYear} onChange={e => setMarketExpenseSearchYear(e.target.value)} />
                <Button onClick={handleMarketExpenseSearch} disabled={marketExpenseLoading || !marketExpenseSearchMonth} className="h-8 gap-1 text-sm bg-blue-600 hover:bg-blue-700 text-white">
                  {marketExpenseLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  সার্চ
                </Button>
              </div>
            </div>

            {/* সার্চ রেজাল্ট */}
            {marketExpenseResults.length > 0 && (
              <div className="space-y-2">
                {/* টোটাল খরচ বড় কার্ড — ক্লিক করলে expand/collapse হবে */}
                <div
                  onClick={() => setMarketExpenseDetailsOpen(!marketExpenseDetailsOpen)}
                  className="bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-200 rounded-xl p-4 cursor-pointer hover:from-orange-100 hover:to-amber-100 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center shadow-lg">
                        <ReceiptText className="h-6 w-6 text-white" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">{marketExpenseSearchMonth} {marketExpenseSearchYear} — মোট খরচ</p>
                        <p className="text-3xl font-bold text-orange-700 font-mono">
                          {marketExpenseTotal.toLocaleString('bn-BD')} টাকা
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium text-orange-500">
                        {marketExpenseDetailsOpen ? '▸ সংকোচন' : '▸ বিস্তারিত দেখুন'}
                      </span>
                      <ChevronDown className={`h-5 w-5 text-orange-400 transition-transform ${marketExpenseDetailsOpen ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                  {/* collapsed state-এ ছোট summary */}
                  {!marketExpenseDetailsOpen && (
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="secondary" className="bg-orange-100 text-orange-700 text-[10px]">
                        {marketExpenseResults.length}টি এন্ট্রি
                      </Badge>
                    </div>
                  )}
                </div>

                {/* বিস্তারিত তালিকা — expand হলে দেখাবে */}
                {marketExpenseDetailsOpen && (
                <div className="border rounded-lg overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-left">তারিখ</th>
                        <th className="px-3 py-2 text-left">মালের বিবরণ</th>
                        <th className="px-3 py-2 text-right">টোটাল খরচ</th>
                        <th className="px-3 py-2 text-center">অ্যাকশন</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketExpenseResults.map((exp: any, i: number) => (
                        <tr key={exp.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          {marketExpenseEditId === exp.id ? (
                            <>
                              <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                              <td className="px-3 py-1.5"><Input type="date" className="h-7 text-xs" value={marketExpenseEditForm.expenseDate || ''} onChange={e => setMarketExpenseEditForm(p => ({ ...p, expenseDate: e.target.value }))} /></td>
                              <td className="px-3 py-1.5"><Input className="h-7 text-xs" value={marketExpenseEditForm.description || ''} onChange={e => setMarketExpenseEditForm(p => ({ ...p, description: e.target.value }))} /></td>
                              <td className="px-3 py-1.5"><Input type="number" className="h-7 text-xs text-right" value={marketExpenseEditForm.totalCost || ''} onChange={e => setMarketExpenseEditForm(p => ({ ...p, totalCost: e.target.value }))} /></td>
                              <td className="px-3 py-1.5 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <Button size="sm" variant="ghost" className="h-7 text-xs text-emerald-600 hover:bg-emerald-50" onClick={handleMarketExpenseEditSave} disabled={marketExpenseEditSaving}>
                                    {marketExpenseEditSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-500 hover:bg-slate-100" onClick={() => setMarketExpenseEditId(null)}>
                                    ✕
                                  </Button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                              <td className="px-3 py-2">{exp.expenseDate || '-'}</td>
                              <td className="px-3 py-2">{exp.description || '-'}</td>
                              <td className="px-3 py-2 text-right font-mono font-medium">{Number(exp.totalCost || 0).toLocaleString('bn-BD')} টাকা</td>
                              <td className="px-3 py-2 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <Button size="sm" variant="ghost" className="h-7 text-xs text-blue-600 hover:bg-blue-50" onClick={() => handleMarketExpenseEdit(exp)}>
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:bg-red-50" onClick={() => handleMarketExpenseDelete(exp.id)}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-orange-50 border-t">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-sm font-bold text-right">মোট খরচ:</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-orange-700">{marketExpenseTotal.toLocaleString('bn-BD')} টাকা</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                )}
              </div>
            )}

            {marketExpenseSearchMonth && marketExpenseSearchYear && marketExpenseResults.length === 0 && !marketExpenseLoading && (
              <div className="text-center py-6 text-sm text-slate-500">এই মাসে কোনো খরচ পাওয়া যায়নি</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== মাস অনুযায়ী মোট মিল Panel ===== */}
      {activePanel === 'monthlyMealTotal' && (
        <Card className="shadow-md border-0">
          <CardHeader className="pb-2 bg-indigo-50 rounded-t-lg">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-indigo-600" />মাস অনুযায়ী মোট মিল
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 space-y-3">
            {/* মাস ও বছর সিলেক্ট */}
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-600">মাস সিলেক্ট করুন</label>
                <Select value={monthlyMealMonth} onValueChange={v => { setMonthlyMealMonth(v); setMonthlyMealSummary(null); }}>
                  <SelectTrigger className="h-8 w-40 text-sm"><SelectValue placeholder="মাস সিলেক্ট" /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.slice(1).map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-600">বছর</label>
                <Input className="h-8 w-24 text-sm" placeholder="বছর" value={monthlyMealYear} onChange={e => { setMonthlyMealYear(e.target.value); setMonthlyMealSummary(null); }} />
              </div>
              <Button onClick={handleMonthlyMealSearch} disabled={monthlyMealLoading || !monthlyMealMonth} className="h-8 gap-1 text-sm bg-blue-600 hover:bg-blue-700 text-white">
                {monthlyMealLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                দেখুন
              </Button>
            </div>

            {/* ফলাফল */}
            {monthlyMealSummary && monthlyMealSummary.summary && (
              <div className="space-y-3">
                {/* মোট মিলের কার্ড */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-slate-500 mb-1">সকাল নাস্তা</div>
                    <div className="text-2xl font-bold text-emerald-700">{monthlyMealSummary.summary.totalBreakfast}</div>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-slate-500 mb-1">দুপুর মিল</div>
                    <div className="text-2xl font-bold text-blue-700">{monthlyMealSummary.summary.totalLunch}</div>
                  </div>
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-slate-500 mb-1">সকাল স্পেশাল</div>
                    <div className="text-2xl font-bold text-orange-700">{monthlyMealSummary.summary.totalMorningSpecial}</div>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-slate-500 mb-1">দুপুর স্পেশাল</div>
                    <div className="text-2xl font-bold text-amber-700">{monthlyMealSummary.summary.totalLunchSpecial}</div>
                  </div>
                </div>

                {/* ব্যক্তিগত বিস্তারিত */}
                {monthlyMealSummary.details && monthlyMealSummary.details.length > 0 && (
                  <div className="space-y-1.5">
                    <div
                      onClick={() => setMonthlyMealDetailsOpen(!monthlyMealDetailsOpen)}
                      className="flex items-center justify-between cursor-pointer hover:bg-slate-50 rounded px-1 py-1 transition-colors"
                    >
                      <p className="text-xs font-medium text-slate-700">📋 ব্যক্তিগত বিস্তারিত ({monthlyMealSummary.details.length} জন)</p>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-medium text-blue-600">{monthlyMealDetailsOpen ? '▸ সংকোচন করুন' : '▸ বিস্তারিত দেখুন'}</span>
                        <ChevronDown className={`h-3 w-3 text-blue-600 transition-transform ${monthlyMealDetailsOpen ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                    {monthlyMealDetailsOpen && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            if (monthlyMealExpandedRows.size === monthlyMealSummary.details.length) {
                              setMonthlyMealExpandedRows(new Set());
                            } else {
                              setMonthlyMealExpandedRows(new Set(monthlyMealSummary.details.map((_: any, i: number) => i)));
                            }
                          }}
                          className="text-[10px] font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {monthlyMealExpandedRows.size === monthlyMealSummary.details.length ? 'সব সংকোচন' : 'সব expand'}
                        </button>
                      </div>
                    <div className="border rounded-lg overflow-hidden">
                      <div className="sticky top-0 bg-slate-100 border-b border-slate-200 px-2 py-1.5 grid grid-cols-12 items-center text-[9px] font-medium text-slate-500">
                        <span className="col-span-1 text-center">#</span>
                        <span className="col-span-3">নাম</span>
                        <span className="col-span-2 text-center">সকাল</span>
                        <span className="col-span-2 text-center">দুপুর</span>
                        <span className="col-span-2 text-center">সঃস্পে</span>
                        <span className="col-span-2 text-center">দঃস্পে</span>
                      </div>
                      <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                        {monthlyMealSummary.details.map((d: any, i: number) => {
                          const isExpanded = monthlyMealExpandedRows.has(i);
                          const totalMeals = (d.totalBreakfast || 0) + (d.totalLunch || 0) + (d.totalMorningSpecial || 0) + (d.totalLunchSpecial || 0);
                          return (
                            <div key={i}>
                              <div
                                onClick={() => {
                                  setMonthlyMealExpandedRows(prev => {
                                    const next = new Set(prev);
                                    if (next.has(i)) next.delete(i); else next.add(i);
                                    return next;
                                  });
                                }}
                                className="px-2 py-1.5 cursor-pointer hover:bg-slate-50 transition-colors grid grid-cols-12 items-center"
                              >
                                <span className="col-span-1 text-[9px] text-slate-400 text-center">{i + 1}</span>
                                <div className="col-span-3 min-w-0 flex items-center gap-0.5">
                                  <p className="text-[11px] font-medium truncate">{d.name}</p>
                                  {isExpanded && (
                                    <p className="text-[9px] text-slate-500 truncate">
                                      {d.designation && <span className="text-slate-600 font-medium">{d.designation}</span>}
                                      {d.designation && d.mobile && <span className="text-slate-400"> • </span>}
                                      {d.mobile && <span>{d.mobile}</span>}
                                    </p>
                                  )}
                                </div>
                                {isExpanded ? (
                                  <>
                                    <span className="col-span-2 text-center">{d.totalBreakfast > 0 ? <span className="inline-flex items-center justify-center w-5 h-5 bg-emerald-500 text-white font-bold rounded-full text-[9px] shadow">{d.totalBreakfast}</span> : <span className="text-slate-300 text-[10px]">—</span>}</span>
                                    <span className="col-span-2 text-center">{d.totalLunch > 0 ? <span className="inline-flex items-center justify-center w-5 h-5 bg-blue-500 text-white font-bold rounded-full text-[9px] shadow">{d.totalLunch}</span> : <span className="text-slate-300 text-[10px]">—</span>}</span>
                                    <span className="col-span-2 text-center">{d.totalMorningSpecial > 0 ? <span className="inline-flex items-center justify-center w-5 h-5 bg-orange-500 text-white font-bold rounded-full text-[9px] shadow">{d.totalMorningSpecial}</span> : <span className="text-slate-300 text-[10px]">—</span>}</span>
                                    <span className="col-span-2 text-center">{d.totalLunchSpecial > 0 ? <span className="inline-flex items-center justify-center w-5 h-5 bg-amber-500 text-white font-bold rounded-full text-[9px] shadow">{d.totalLunchSpecial}</span> : <span className="text-slate-300 text-[10px]">—</span>}</span>
                                  </>
                                ) : (
                                  <span className="col-span-8 text-right">
                                    {totalMeals > 0 && <span className="text-[9px] text-slate-400 font-medium">মোট: {totalMeals}</span>}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    </div>
                    )}
                  </div>
                )}

                {monthlyMealSummary.details && monthlyMealSummary.details.length === 0 && (
                  <div className="text-center py-4 text-xs text-slate-400">এই মাসে কোনো মিল অর্ডার পাওয়া যায়নি</div>
                )}
              </div>
            )}

            {monthlyMealMonth && monthlyMealYear && !monthlyMealSummary && !monthlyMealLoading && (
              <div className="text-center py-4 text-xs text-slate-400">মাস ও বছর সিলেক্ট করে "দেখুন" বাটনে ক্লিক করুন</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== রান্না Panel ===== */}
      {activePanel === 'rannaPanel' && (
        <Card className="shadow-md border-0">
          <CardContent className="pt-3 space-y-2">
            {/* স্পেশাল মিল এক্টিভেশন */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-2">
              <p className="text-xs font-semibold text-amber-800">🔥 স্পেশাল মিল এক্টিভ করুন</p>
              <p className="text-[10px] text-amber-700">নিচের তারিখে স্পেশাল মিল এক্টিভ করলে মিল অর্ডার পেজে সেই তারিখের জন্য স্পেশাল বাটন চালু হবে।</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                <div className="space-y-0.5">
                  <label className="text-[9px] font-medium text-slate-600">তারিখ সিলেক্ট করুন</label>
                  <Input type="date" className="h-7 text-xs" value={rannaDate || ''} onChange={e => setRannaDate(e.target.value)} />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[9px] font-medium text-slate-600">স্পেশাল মিল টাইপ</label>
                  <div className="flex gap-1.5 h-7">
                    <button
                      onClick={() => setRannaMorningSpecial(!rannaMorningSpecial)}
                      className={`flex-1 h-7 text-[10px] font-medium rounded border-2 transition-all ${
                        rannaMorningSpecial
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-white text-slate-500 border-slate-300 hover:border-orange-300'
                      }`}
                    >
                      {rannaMorningSpecial ? '✓ ' : ''}সকাল স্পেশাল
                    </button>
                    <button
                      onClick={() => setRannaLunchSpecial(!rannaLunchSpecial)}
                      className={`flex-1 h-7 text-[10px] font-medium rounded border-2 transition-all ${
                        rannaLunchSpecial
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-white text-slate-500 border-slate-300 hover:border-orange-300'
                      }`}
                    >
                      {rannaLunchSpecial ? '✓ ' : ''}দুপুর স্পেশাল
                    </button>
                  </div>
                </div>
                <div className="flex items-end">
                  <Button onClick={handleRannaSave} disabled={rannaSaving || !rannaDate || (!rannaMorningSpecial && !rannaLunchSpecial)} className="w-full h-7 bg-orange-600 hover:bg-orange-700 gap-1 text-xs">
                    {rannaSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Flame className="h-3 w-3" />}
                    এক্টিভ করুন
                  </Button>
                </div>
              </div>
              {rannaMorningSpecial && (
                <p className="text-[9px] text-amber-600">⚠️ সকাল স্পেশাল এক্টিভ থাকলে "সকাল নাস্তা" বাটন নিষ্ক্রিয় থাকবে</p>
              )}
              {rannaLunchSpecial && (
                <p className="text-[9px] text-amber-600">⚠️ দুপুর স্পেশাল এক্টিভ থাকলে "দুপুর মিল" বাটন নিষ্ক্রিয় থাকবে</p>
              )}
            </div>

            <Separator />

            {/* সেটিংস হিস্ট্রি */}
            {rannaSettings.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-slate-700">📋 স্পেশাল মিল সেটিংস তালিকা</p>
                <div className="border rounded overflow-hidden">
                  <table className="w-full text-[10px]">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="px-2 py-1 text-left">তারিখ</th>
                        <th className="px-2 py-1 text-center">সকাল স্পেশাল</th>
                        <th className="px-2 py-1 text-center">দুপুর স্পেশাল</th>
                        <th className="px-2 py-1 text-center">স্ট্যাটাস</th>
                        <th className="px-2 py-1 text-center">অ্যাকশন</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rannaSettings.map((s: any) => (
                        <tr key={s.id} className={s.isActive ? 'bg-white' : 'bg-red-50 opacity-60'}>
                          <td className="px-2 py-1 font-medium">{s.orderDate}</td>
                          <td className="px-2 py-1 text-center">{s.morningSpecial ? '✓' : '—'}</td>
                          <td className="px-2 py-1 text-center">{s.lunchSpecial ? '✓' : '—'}</td>
                          <td className="px-2 py-1 text-center">
                            <Badge className={s.isActive ? 'bg-emerald-100 text-emerald-700 text-[9px] px-1 py-0' : 'bg-red-100 text-red-600 text-[9px] px-1 py-0'}>
                              {s.isActive ? 'সক্রিয়' : 'মেয়াদোত্তীর্ণ'}
                            </Badge>
                          </td>
                          <td className="px-2 py-1 text-center">
                            <button
                              onClick={() => handleRannaDeleteSetting(s.orderDate)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded p-0.5"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {rannaSettings.length === 0 && (
              <div className="text-center py-2 text-xs text-slate-400">কোনো স্পেশাল মিল সেটিং নেই</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* এডমিন অর্ডার এডিট ডায়ালগ */}
      <Dialog open={!!rannaEditOrder} onOpenChange={() => setRannaEditOrder(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">অর্ডার এডিট — {rannaEditOrder?.name}</DialogTitle></DialogHeader>
          {rannaEditOrder && (
            <div className="space-y-2">
              <div className="text-[10px] text-slate-500 bg-slate-50 px-2 py-1 rounded">
                আইডি: {rannaEditOrder.officeId} • পদবী: {rannaEditOrder.designation || '—'}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { label: 'সকাল নাস্তা', key: 'breakfast', color: 'emerald' },
                  { label: 'দুপুর মিল', key: 'lunch', color: 'blue' },
                  { label: 'সকাল স্পেশাল', key: 'morningSpecial', color: 'orange' },
                  { label: 'দুপুর স্পেশাল', key: 'lunchSpecial', color: 'orange' },
                ].map(item => (
                  <div key={item.key} className={`flex items-center justify-between px-2 py-1.5 rounded border-2 border-slate-200 bg-white`}>
                    <span className="text-[10px] font-medium text-slate-600">{item.label}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          const val = (Number(rannaEditOrder[item.key]) || 0) - 1;
                          setRannaEditOrder({ ...rannaEditOrder, [item.key]: Math.max(0, val) });
                        }}
                        className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold"
                      >−</button>
                      <span className="w-6 text-center text-xs font-bold text-slate-800">{Number(rannaEditOrder[item.key]) || 0}</span>
                      <button
                        onClick={() => {
                          const val = (Number(rannaEditOrder[item.key]) || 0) + 1;
                          setRannaEditOrder({ ...rannaEditOrder, [item.key]: val });
                        }}
                        className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold"
                      >+</button>
                    </div>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setRannaEditOrder(null)}>বাতিল</Button>
                <Button size="sm" onClick={handleRannaAdminEditOrder} disabled={rannaEditSaving} className="bg-emerald-600 hover:bg-emerald-700">
                  {rannaEditSaving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                  আপডেট করুন
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Entry Dialog — শুধুমাত্র মেম্বার তথ্য এডিট */}
      <Dialog open={!!editEntry} onOpenChange={() => setEditEntry(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>সদস্য তথ্য এডিট করুন</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">অফিস আইডি (পরিবর্তন যোগ্য নয়)</label>
              <Input className="h-9 bg-slate-100" value={editForm.officeId || ''} disabled />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">নাম</label>
              <div className="relative">
                <Input className="h-9" value={editForm.name || ''} onChange={e => handleEditFormFieldChange('name', e.target.value)} placeholder="নাম লিখুন"
                  onBlur={() => setTimeout(() => setEditFormSuggestOpen(false), 200)} />
                {editLookupLoading && <Loader2 className="h-3 w-3 animate-spin absolute right-2 top-2.5 text-slate-400" />}
                {editFormSuggestOpen && editFormSuggestions.length > 0 && editFormSuggestField === 'name' && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                    {editFormSuggestions.map((u, i) => (
                      <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                        onMouseDown={e => { e.preventDefault(); handleEditFormSuggestionSelect(u); }}>
                        <span className="font-bold text-emerald-700">{u.name}</span>
                        {u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}
                        <span className="text-slate-400 ml-2">{u.officeId}</span>
                        {u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">মোবাইল নম্বর</label>
              <div className="relative">
                <Input className="h-9" value={editForm.mobile || ''} onChange={e => handleEditFormFieldChange('mobile', e.target.value)} placeholder="মোবাইল নম্বর লিখুন"
                  onBlur={() => setTimeout(() => setEditFormSuggestOpen(false), 200)} />
                {editLookupLoading && <Loader2 className="h-3 w-3 animate-spin absolute right-2 top-2.5 text-slate-400" />}
                {editFormSuggestOpen && editFormSuggestions.length > 0 && editFormSuggestField === 'mobile' && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                    {editFormSuggestions.map((u, i) => (
                      <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                        onMouseDown={e => { e.preventDefault(); handleEditFormSuggestionSelect(u); }}>
                        <span className="font-bold text-emerald-700">{formatMobile(u.mobile)}</span>
                        <span className="font-medium text-slate-800 ml-2">{u.name}</span>
                        {u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}
                        <span className="text-slate-400 ml-1">{u.officeId}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">পদবী</label>
              <div className="relative">
                <Input className="h-9" value={editForm.designation || ''} onChange={e => handleEditFormFieldChange('designation', e.target.value)} placeholder="পদবী"
                  onBlur={() => setTimeout(() => setEditFormSuggestOpen(false), 200)} />
                {editFormSuggestOpen && editFormSuggestions.length > 0 && editFormSuggestField === 'designation' && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                    {editFormSuggestions.map((u, i) => (
                      <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                        onMouseDown={e => { e.preventDefault(); handleEditFormSuggestionSelect(u); }}>
                        <span className="font-bold text-emerald-700">{u.designation}</span>
                        <span className="font-medium text-slate-800 ml-2">{u.name}</span>
                        <span className="text-slate-400 ml-1">{u.officeId}</span>
                        {u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="text-[10px] text-slate-400">নোট: এই পরিবর্তন এই অফিস আইডির সব এন্ট্রিতে আপডেট হবে</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntry(null)}>বাতিল</Button>
            <Button onClick={handleSaveEntry} disabled={editLoading} className="bg-emerald-600 hover:bg-emerald-700">
              {editLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'সেভ করুন'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Setting Dialog */}
      <Dialog open={!!editSetting} onOpenChange={() => setEditSetting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>প্রাইস সেটিং এডিট — {editSetting?.month} {editSetting?.year}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'breakfastPrice', label: 'সকাল নাস্তা' },
              { key: 'lunchPrice', label: 'দুপুর মিল' },
              { key: 'morningSpecial', label: 'সকাল স্পেশাল' },
              { key: 'lunchSpecial', label: 'দুপুর স্পেশাল' },
            ].map(f => (
              <div key={f.key}>
                <label className="text-xs font-medium text-slate-600">{f.label}</label>
                <Input type="number" className="h-9" value={settingForm[f.key] || '0'}
                  onChange={e => setSettingForm({ ...settingForm, [f.key]: e.target.value })} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSetting(null)}>বাতিল</Button>
            <Button onClick={handleSaveSetting} disabled={editLoading} className="bg-emerald-600 hover:bg-emerald-700">সেভ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Setting Dialog */}
      <Dialog open={newSettingOpen} onOpenChange={setNewSettingOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>নতুন প্রাইস সেটিং</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600">মাস</label>
              <Select value={newSettingForm.month} onValueChange={v => setNewSettingForm({ ...newSettingForm, month: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{MONTHS_NO_ALL.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">বছর</label>
              <Input className="h-9" value={newSettingForm.year || ''} onChange={e => setNewSettingForm({ ...newSettingForm, year: e.target.value })} />
            </div>
            {[
              { key: 'breakfastPrice', label: 'সকাল নাস্তা' },
              { key: 'lunchPrice', label: 'দুপুর মিল' },
              { key: 'morningSpecial', label: 'সকাল স্পেশাল' },
              { key: 'lunchSpecial', label: 'দুপুর স্পেশাল' },
            ].map(f => (
              <div key={f.key}>
                <label className="text-xs font-medium text-slate-600">{f.label}</label>
                <Input type="number" className="h-9" value={newSettingForm[f.key] || '0'}
                  onChange={e => setNewSettingForm({ ...newSettingForm, [f.key]: e.target.value })} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewSettingOpen(false)}>বাতিল</Button>
            <Button onClick={handleNewSetting} className="bg-emerald-600 hover:bg-emerald-700">সেভ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV ডাউনলোড Dialog */}
      <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5 text-emerald-600" /> CSV ডাউনলোড
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">মাস ও বছর সিলেক্ট করে ডাটাবেজ ডাউনলোড করুন।</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">মাস</label>
                <Select value={csvMonth} onValueChange={setCsvMonth}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="সকল মাস" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">সকল মাস</SelectItem>
                    {MONTHS_NO_ALL.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">বছর</label>
                <Input type="number" placeholder="2026" value={csvYear} onChange={e => setCsvYear(e.target.value)} className="h-9" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCsvOpen(false)}>বাতিল</Button>
            <Button onClick={handleExportCSV} disabled={!csvYear} className="bg-emerald-600 hover:bg-emerald-700 gap-1">
              <Download className="h-4 w-4" /> ডাউনলোড
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ডাটাবেজ Dialog - ৫টি ট্যাব */}
      <Dialog open={deleteDbOpen} onOpenChange={handleDeleteDbOpen}>
        <DialogContent className="max-w-[700px] w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-purple-700">
              <Database className="h-5 w-5" /> ডাটাবেজ
            </DialogTitle>
          </DialogHeader>

          <Tabs value={deleteTab} onValueChange={(v) => { setDeleteTab(v as 'edit' | 'add' | 'search' | 'year' | 'all'); if (v === 'all') { setAllDeletePasswordStep(true); setAllDeleteVerified(false); setAllDeletePassword(''); setAllDeletePasswordError(''); } }}>
            <TabsList className="flex w-full bg-slate-200 p-1 gap-1">
              <TabsTrigger value="edit" className="flex-1 text-[9px] sm:text-[11px] truncate px-1 sm:px-2 rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:border-purple-700 data-[state=active]:shadow-md">সদস্য তথ্য এডিট</TabsTrigger>
              <TabsTrigger value="add" className="flex-1 text-[9px] sm:text-[11px] truncate px-1 sm:px-2 rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:border-purple-700 data-[state=active]:shadow-md">সদস্য যোগ</TabsTrigger>
              <TabsTrigger value="search" className="flex-1 text-[9px] sm:text-[11px] truncate px-1 sm:px-2 rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:border-purple-700 data-[state=active]:shadow-md">মিল এবং জমা টাকা</TabsTrigger>
              <TabsTrigger value="year" className="flex-1 text-[9px] sm:text-[11px] truncate px-1 sm:px-2 rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:border-purple-700 data-[state=active]:shadow-md">বছরভিত্তিক ডিলিট</TabsTrigger>
              <TabsTrigger value="all" className="flex-1 text-[9px] sm:text-[11px] font-bold truncate px-1 sm:px-2 rounded-md border border-red-300 bg-white text-red-600 shadow-sm data-[state=active]:bg-red-600 data-[state=active]:text-white data-[state=active]:border-red-700 data-[state=active]:shadow-md">All Delete</TabsTrigger>
            </TabsList>

            {/* ===== Tab: সদস্য তথ্য এডিট ===== */}
            <TabsContent value="edit" className="space-y-3">
              <p className="text-xs text-slate-500">অফিস আইডি, মোবাইল নম্বর বা নাম দিয়ে সদস্য খুঁজুন। তারপর নাম, মোবাইল নম্বর ও পদবী এডিট করুন।</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                <div className="space-y-0.5 md:col-span-2">
                  <label className="text-[10px] font-medium text-slate-500">অফিস আইডি / মোবাইল / নাম</label>
                  <div className="relative">
                    <Input placeholder="অফিস আইডি / মোবাইল / নাম লিখুন" value={filterQuery} onChange={e => handleEditSearchTyping(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAdminSearch()}
                      onBlur={() => setTimeout(() => setEditSuggestOpen(false), 200)}
                      className="h-9" />
                    {editLookupPreviewLoading && <Loader2 className="h-4 w-4 animate-spin absolute right-2 top-2.5 text-slate-400" />}
                    {editSuggestOpen && editSuggestions.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {editSuggestions.map((u, i) => (
                          <button key={i} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                            onMouseDown={e => { e.preventDefault(); handleEditSuggestionSelect(u); }}>
                            <span className="font-medium text-slate-800">{u.name}</span>
                            {u.designation && <span className="text-blue-600 ml-1.5">[{u.designation}]</span>}
                            <span className="text-slate-400 ml-2 text-xs">{u.officeId}</span>
                            {u.mobile && <span className="text-slate-400 ml-1.5 text-xs">{formatMobile(u.mobile)}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {editLookupPreview && !editEntry && (
                    <div className="mt-1 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-700">
                      <CheckCircle className="h-3 w-3 inline mr-1 text-emerald-600" />
                      {editLookupPreview.name}{editLookupPreview.designation ? ` [${editLookupPreview.designation}]` : ''}{editLookupPreview.officeId ? ` — ${editLookupPreview.officeId}` : ''}{editLookupPreview.mobile ? ` (${formatMobile(editLookupPreview.mobile)})` : ''}
                    </div>
                  )}
                </div>
                <Button onClick={handleAdminSearch} disabled={loading} className="h-9 bg-emerald-600 hover:bg-emerald-700 gap-1">
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  সার্চ
                </Button>
              </div>
              {editEntry ? (
                <div className="p-4 bg-white border rounded-lg space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <User className="h-4 w-4 text-emerald-600" />
                    <span className="text-sm font-bold text-slate-700">সদস্য তথ্য পাওয়া গেছে</span>
                    <Badge variant="outline" className="text-xs">{editEntry.officeId || 'আইডি নেই'}</Badge>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">অফিস আইডি (পরিবর্তন যোগ্য নয়)</label>
                    <Input className="h-9 bg-slate-100" value={editForm.officeId || ''} disabled />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">নাম</label>
                    <div className="relative">
                      <Input className="h-9" value={editForm.name || ''} onChange={e => handleEditFormFieldChange('name', e.target.value)} placeholder="নাম লিখুন"
                        onBlur={() => setTimeout(() => setEditFormSuggestOpen(false), 200)} />
                      {editFormSuggestOpen && editFormSuggestions.length > 0 && editFormSuggestField === 'name' && (
                        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                          {editFormSuggestions.map((u, i) => (
                            <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                              onMouseDown={e => { e.preventDefault(); handleEditFormSuggestionSelect(u); }}>
                              <span className="font-bold text-emerald-700">{u.name}</span>
                              {u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}
                              <span className="text-slate-400 ml-2">{u.officeId}</span>
                              {u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">মোবাইল নম্বর</label>
                    <div className="relative">
                      <Input className="h-9" value={editForm.mobile || ''} onChange={e => handleEditFormFieldChange('mobile', e.target.value)} placeholder="মোবাইল নম্বর লিখুন"
                        onBlur={() => setTimeout(() => setEditFormSuggestOpen(false), 200)} />
                      {editFormSuggestOpen && editFormSuggestions.length > 0 && editFormSuggestField === 'mobile' && (
                        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                          {editFormSuggestions.map((u, i) => (
                            <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                              onMouseDown={e => { e.preventDefault(); handleEditFormSuggestionSelect(u); }}>
                              <span className="font-bold text-emerald-700">{formatMobile(u.mobile)}</span>
                              <span className="font-medium text-slate-800 ml-2">{u.name}</span>
                              {u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}
                              <span className="text-slate-400 ml-1">{u.officeId}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">পদবী</label>
                    <div className="relative">
                      <Input className="h-9" value={editForm.designation || ''} onChange={e => handleEditFormFieldChange('designation', e.target.value)} placeholder="পদবী"
                        onBlur={() => setTimeout(() => setEditFormSuggestOpen(false), 200)} />
                      {editFormSuggestOpen && editFormSuggestions.length > 0 && editFormSuggestField === 'designation' && (
                        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                          {editFormSuggestions.map((u, i) => (
                            <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                              onMouseDown={e => { e.preventDefault(); handleEditFormSuggestionSelect(u); }}>
                              <span className="font-bold text-emerald-700">{u.designation}</span>
                              <span className="font-medium text-slate-800 ml-2">{u.name}</span>
                              <span className="text-slate-400 ml-1">{u.officeId}</span>
                              {u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400">নোট: এই পরিবর্তন এই ব্যক্তির সব এন্ট্রিতে আপডেট হবে</p>
                  <div className="flex gap-2">
                    <Button onClick={handleSaveEntry} disabled={editLoading} className="bg-emerald-600 hover:bg-emerald-700 gap-1">
                      {editLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                      আপডেট করুন
                    </Button>
                    <Button variant="outline" onClick={() => { setEditEntry(null); setFilterQuery(''); }}>বাতিল</Button>
                  </div>
                </div>
              ) : hasSearched && !loading && entries.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">কোনো সদস্য পাওয়া যায়নি</p>
                  <p className="text-xs mt-1">সঠিক অফিস আইডি, মোবাইল নম্বর বা নাম দিয়ে আবার সার্চ করুন</p>
                </div>
              ) : !hasSearched ? (
                <div className="text-center py-12 text-slate-400">
                  <Pencil className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  <p className="text-sm font-medium">সার্চ করুন</p>
                  <p className="text-xs mt-1">অফিস আইডি, মোবাইল নম্বর বা নাম দিয়ে সদস্য খুঁজুন</p>
                </div>
              ) : null}
            </TabsContent>

            {/* ===== Tab: সদস্য যোগ ===== */}
            <TabsContent value="add" className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div className="space-y-0.5">
                  <label className="text-[10px] font-medium text-slate-500">অফিস আইডি</label>
                  <div className="relative">
                    <Input placeholder="অফিস আইডি" value={memberForm.officeId || ''} onChange={e => handleMemberFormChange('officeId', e.target.value)} onBlur={() => handleMemberFieldBlur('officeId')} className="h-8 text-sm" />
                    {memberLookupLoading && <Loader2 className="h-3 w-3 animate-spin absolute right-1.5 top-2 text-slate-400" />}
                    {memberSuggestOpen && memberSuggestions.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                        {memberSuggestions.map((u, i) => (
                          <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 border-b border-slate-100 last:border-0 transition-colors"
                            onMouseDown={e => { e.preventDefault(); selectSuggestion(u, setMemberForm, setMemberSuggestions, setMemberSuggestOpen, setMemberLookupResult); }}>
                            {memberSuggestField === 'officeId' ? (
                              <><span className="font-bold text-emerald-700">{u.officeId}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                            ) : memberSuggestField === 'name' ? (
                              <><span className="font-bold text-emerald-700">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                            ) : memberSuggestField === 'mobile' ? (
                              <><span className="font-bold text-emerald-700">{formatMobile(u.mobile)}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-1">{u.officeId}</span></>
                            ) : memberSuggestField === 'designation' ? (
                              <><span className="font-bold text-emerald-700">{u.designation}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span><span className="text-slate-400 ml-1">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                            ) : (
                              <><span className="font-medium text-slate-800">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] font-medium text-slate-500">নাম</label>
                  <div className="relative">
                    <Input placeholder="নাম" value={memberForm.name || ''} onChange={e => handleMemberFormChange('name', e.target.value)} onBlur={() => handleMemberFieldBlur('name')} className="h-8 text-sm" />
                    {memberLookupLoading && <Loader2 className="h-3 w-3 animate-spin absolute right-1.5 top-2 text-slate-400" />}
                    {memberSuggestOpen && memberSuggestions.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                        {memberSuggestions.map((u, i) => (
                          <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 border-b border-slate-100 last:border-0 transition-colors"
                            onMouseDown={e => { e.preventDefault(); selectSuggestion(u, setMemberForm, setMemberSuggestions, setMemberSuggestOpen, setMemberLookupResult); }}>
                            {memberSuggestField === 'officeId' ? (
                              <><span className="font-bold text-emerald-700">{u.officeId}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                            ) : memberSuggestField === 'name' ? (
                              <><span className="font-bold text-emerald-700">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                            ) : memberSuggestField === 'mobile' ? (
                              <><span className="font-bold text-emerald-700">{formatMobile(u.mobile)}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-1">{u.officeId}</span></>
                            ) : memberSuggestField === 'designation' ? (
                              <><span className="font-bold text-emerald-700">{u.designation}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span><span className="text-slate-400 ml-1">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                            ) : (
                              <><span className="font-medium text-slate-800">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] font-medium text-slate-500">মোবাইল</label>
                  <div className="relative">
                    <Input placeholder="মোবাইল" value={memberForm.mobile || ''} onChange={e => handleMemberFormChange('mobile', e.target.value)} onBlur={() => handleMemberFieldBlur('mobile')} className="h-8 text-sm" />
                    {memberLookupLoading && <Loader2 className="h-3 w-3 animate-spin absolute right-1.5 top-2 text-slate-400" />}
                    {memberSuggestOpen && memberSuggestions.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                        {memberSuggestions.map((u, i) => (
                          <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 border-b border-slate-100 last:border-0 transition-colors"
                            onMouseDown={e => { e.preventDefault(); selectSuggestion(u, setMemberForm, setMemberSuggestions, setMemberSuggestOpen, setMemberLookupResult); }}>
                            {memberSuggestField === 'officeId' ? (
                              <><span className="font-bold text-emerald-700">{u.officeId}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                            ) : memberSuggestField === 'name' ? (
                              <><span className="font-bold text-emerald-700">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                            ) : memberSuggestField === 'mobile' ? (
                              <><span className="font-bold text-emerald-700">{formatMobile(u.mobile)}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-1">{u.officeId}</span></>
                            ) : memberSuggestField === 'designation' ? (
                              <><span className="font-bold text-emerald-700">{u.designation}</span><span className="font-medium text-slate-800 ml-2">{u.name}</span><span className="text-slate-400 ml-1">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                            ) : (
                              <><span className="font-medium text-slate-800">{u.name}</span>{u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}<span className="text-slate-400 ml-2">{u.officeId}</span>{u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}</>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] font-medium text-slate-500">পদবী</label>
                  <div className="relative">
                    <Input value={memberForm.designation || ''} onChange={e => handleMemberFormChange('designation', e.target.value)} onBlur={() => setMemberSuggestOpen(false)} className="h-8 text-sm" />
                    {memberSuggestOpen && memberSuggestField === 'designation' && memberSuggestions.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                        {memberSuggestions.map((u, i) => (
                          <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 border-b border-slate-100 last:border-0 transition-colors"
                            onMouseDown={e => { e.preventDefault(); selectSuggestion(u, setMemberForm, setMemberSuggestions, setMemberSuggestOpen, setMemberLookupResult); }}>
                            <span className="font-bold text-emerald-700">{u.designation}</span>
                            <span className="font-medium text-slate-800 ml-2">{u.name}</span>
                            <span className="text-slate-400 ml-1">{u.officeId}</span>
                            {u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-end">
                  <Button onClick={handleMemberSave} disabled={memberSaving || !memberForm.officeId?.trim() || !memberForm.name?.trim() || !memberForm.mobile?.trim() || !memberForm.designation?.trim() || !!(memberLookupResult && memberLookupResult.officeId !== '__not_found__')} className="w-full h-8 bg-blue-600 hover:bg-blue-700 gap-1 text-sm">
                    {memberSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                    যোগ
                  </Button>
                </div>
              </div>
              {memberLookupResult && memberLookupResult.officeId !== '__not_found__' && (
                <div className="flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-300 rounded-lg">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                  <span className="text-xs text-red-800 font-medium">
                    এই সদস্য আগে থেকেই আছে — পুনরায় যোগ করা যাবে না
                  </span>
                  <span className="text-[10px] text-red-600 ml-1">
                    {memberLookupResult.name}{memberLookupResult.designation ? ` [${memberLookupResult.designation}]` : ''}{memberLookupResult.officeId ? ` — ${memberLookupResult.officeId}` : ''}{memberLookupResult.mobile ? ` (${formatMobile(memberLookupResult.mobile)})` : ''}
                  </span>
                </div>
              )}
            </TabsContent>

            {/* ===== Tab: মিল এবং জমা টাকা ===== */}
            <TabsContent value="search" className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700">এখান থেকে শুধুমাত্র মিল এন্ট্রি এবং জমা টাকা এন্ট্রি এডিট বা ডিলিট করতে পারবেন।ডিলিটের পর ব্যালেন্স স্বয়ংক্রিয়ভাবে রিক্যালকুলেট হবে</p>
              </div>

              {/* সার্চ ফর্ম */}
              <div className="relative">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                  <div>
                    <label className="text-xs font-medium text-slate-600">আইডি / মোবাইল / নাম</label>
                    <div className="relative">
                      <Input placeholder="নাম / 55072 / 01515690200" value={delSearchQuery} onChange={e => { setDelSearchQuery(bnToEn(e.target.value)); setDelSelectedPerson(null); fetchDelSuggestions(bnToEn(e.target.value), setDelSuggestions, setDelSuggestOpen); }}
                        onKeyDown={e => e.key === 'Enter' && handleDelSearch(1)} onBlur={() => setTimeout(() => setDelSuggestOpen(false), 200)} className="h-8 text-sm" />
                      {delSuggestOpen && delSuggestions.length > 0 && (
                        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                          {delSuggestions.map((u, i) => (
                            <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
                              onMouseDown={e => { e.preventDefault(); setDelSearchQuery(u.officeId || u.name); setDelSelectedPerson(u); setDelSuggestOpen(false); setDelSuggestions([]); }}>
                              <span className="font-medium text-slate-800">{u.name}</span>
                              {u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}
                              <span className="text-slate-400 ml-2">{u.officeId}</span>
                              {u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">মাস (ঐচ্ছিক)</label>
                    <Select value={delSearchMonth} onValueChange={setDelSearchMonth}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="সব মাস" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">সব মাস</SelectItem>
                        {MONTHS_NO_ALL.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">বছর (ঐচ্ছিক)</label>
                    <Input type="number" placeholder="2025" value={delSearchYear} onChange={e => setDelSearchYear(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleDelSearch(1)} className="h-8 text-sm" />
                  </div>
                  <div>
                    <Button onClick={() => handleDelSearch(1)} disabled={delSearchLoading || !delSearchQuery.trim()}
                      className="w-full h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-sm gap-1">
                      {delSearchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                      সার্চ
                    </Button>
                  </div>
                </div>
                {delSelectedPerson && (
                  <div className="mt-1.5 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-700">
                    <CheckCircle className="h-3 w-3 inline mr-1 text-emerald-600" />
                    {delSelectedPerson.name}{delSelectedPerson.designation ? ` [${delSelectedPerson.designation}]` : ''}{delSelectedPerson.mobile ? ` — ${formatMobile(delSelectedPerson.mobile)}` : ''}
                  </div>
                )}
              </div>

              {/* রেজাল্ট */}
              {!delSearchHasSearched && (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                  <Search className="h-8 w-8 mb-2" />
                  <p className="text-sm">অফিস আইডি বা মোবাইল দিয়ে সার্চ করুন</p>
                </div>
              )}

              {delSearchHasSearched && delSearchResults.length === 0 && !delSearchLoading && (
                <div className="flex flex-col items-center justify-center py-6 text-amber-500">
                  <AlertTriangle className="h-6 w-6 mb-1" />
                  <p className="text-sm">কোনো এন্ট্রি পাওয়া যায়নি</p>
                </div>
              )}

              {delSearchResults.length > 0 && (
                <>
                  <div className="text-xs text-slate-500">মোট {delSearchTotal}টি এন্ট্রি পাওয়া গেছে (পৃষ্ঠা {delSearchPage}/{delSearchTotalPages})</div>
                  <div className="border rounded-lg overflow-hidden">
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0 z-10">
                          <tr className="border-b">
                            <th className="px-2 py-1.5 text-left font-medium text-slate-600">তারিখ</th>
                            <th className="px-2 py-1.5 text-left font-medium text-slate-600">অফিস আইডি</th>
                            <th className="px-2 py-1.5 text-left font-medium text-slate-600">নাম</th>
                            <th className="px-2 py-1.5 text-left font-medium text-slate-600">পদবী</th>
                            <th className="px-2 py-1.5 text-right font-medium text-slate-600">নাস্তা</th>
                            <th className="px-2 py-1.5 text-right font-medium text-slate-600">দুপুর</th>
                            <th className="px-2 py-1.5 text-right font-medium text-slate-600">স্পেশাল</th>
                            <th className="px-2 py-1.5 text-right font-medium text-slate-600">স্পেশাল</th>
                            <th className="px-2 py-1.5 text-right font-medium text-slate-600">বিল</th>
                            <th className="px-2 py-1.5 text-right font-medium text-slate-600">জমা</th>
                            <th className="px-2 py-1.5 text-right font-medium text-slate-600">ব্যালেন্স</th>
                            <th className="px-2 py-1.5 text-center font-medium text-slate-600">অ্যাকশন</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {delSearchResults.map((entry) => (
                            <tr key={entry.id} className={editingEntryId === entry.id ? 'bg-blue-50' : 'hover:bg-slate-50'}>
                              {editingEntryId === entry.id ? (
                                <>
                                  <td className="px-2 py-1.5 text-slate-700">{fmtDate(entry.entryDate)}</td>
                                  <td className="px-2 py-1.5 text-slate-700">{entry.officeId}</td>
                                  <td className="px-2 py-1.5 text-slate-700">{entry.name}</td>
                                  <td className="px-2 py-1.5 text-slate-500">{(entry as any).designation || '—'}</td>
                                  <td className="px-2 py-1"><Input type="number" value={delEditForm.breakfastCount || '0'} onChange={e => setDelEditForm(p => ({...p, breakfastCount: e.target.value}))} className="h-6 w-14 text-xs text-right" /></td>
                                  <td className="px-2 py-1"><Input type="number" value={delEditForm.lunchCount || '0'} onChange={e => setDelEditForm(p => ({...p, lunchCount: e.target.value}))} className="h-6 w-14 text-xs text-right" /></td>
                                  <td className="px-2 py-1"><Input type="number" value={delEditForm.morningSpecial || '0'} onChange={e => setDelEditForm(p => ({...p, morningSpecial: e.target.value}))} className="h-6 w-14 text-xs text-right" /></td>
                                  <td className="px-2 py-1"><Input type="number" value={delEditForm.lunchSpecial || '0'} onChange={e => setDelEditForm(p => ({...p, lunchSpecial: e.target.value}))} className="h-6 w-14 text-xs text-right" /></td>
                                  <td className="px-2 py-1.5 text-right font-medium text-slate-700">-</td>
                                  <td className="px-2 py-1"><Input type="number" value={delEditForm.deposit || '0'} onChange={e => setDelEditForm(p => ({...p, deposit: e.target.value}))} className="h-6 w-16 text-xs text-right" /></td>
                                  <td className="px-2 py-1.5 text-right font-medium text-slate-700">-</td>
                                  <td className="px-2 py-1 text-center">
                                    <div className="flex items-center gap-1 justify-center">
                                      <Button size="sm" className="h-6 text-[10px] px-2 bg-emerald-600 hover:bg-emerald-700" onClick={handleDelSaveEdit} disabled={delEditLoading}>
                                        {delEditLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                                        সেভ
                                      </Button>
                                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => { setEditingEntryId(null); setDelEditForm({}); }}>
                                        বাতিল
                                      </Button>
                                    </div>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="px-2 py-1.5 text-slate-700">{fmtDate(entry.entryDate)}</td>
                                  <td className="px-2 py-1.5 text-slate-700">{entry.officeId}</td>
                                  <td className="px-2 py-1.5 text-slate-700">{entry.name}</td>
                                  <td className="px-2 py-1.5 text-slate-500">{(entry as any).designation || '—'}</td>
                                  <td className="px-2 py-1.5 text-right text-slate-700">{entry.breakfastCount}</td>
                                  <td className="px-2 py-1.5 text-right text-slate-700">{entry.lunchCount}</td>
                                  <td className="px-2 py-1.5 text-right text-slate-700">{entry.morningSpecial}</td>
                                  <td className="px-2 py-1.5 text-right text-slate-700">{entry.lunchSpecial}</td>
                                  <td className="px-2 py-1.5 text-right font-medium text-red-600">{entry.totalBill}</td>
                                  <td className="px-2 py-1.5 text-right font-medium text-emerald-600">{entry.deposit}</td>
                                  <td className="px-2 py-1.5 text-right font-medium text-slate-800">{entry.curBalance}</td>
                                  <td className="px-2 py-1 text-center">
                                    <div className="flex items-center gap-1 justify-center">
                                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-1.5 gap-0.5 text-blue-600 border-blue-200" onClick={() => handleDelEditEntry(entry)}>
                                        <Pencil className="h-2.5 w-2.5" /> এডিট
                                      </Button>
                                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-1.5 gap-0.5 text-red-600 border-red-200" onClick={() => handleDelDeleteEntry(entry.id, entry.officeId)}>
                                        <Trash2 className="h-2.5 w-2.5" /> ডিলিট
                                      </Button>
                                    </div>
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {/* Pagination */}
                  {delSearchTotalPages > 1 && (
                    <div className="flex items-center justify-center gap-2">
                      <Button size="sm" variant="outline" disabled={delSearchPage <= 1} onClick={() => handleDelSearch(delSearchPage - 1)} className="h-7 text-xs">
                        <ChevronLeft className="h-3 w-3" />
                      </Button>
                      <span className="text-xs text-slate-600">পৃষ্ঠা {delSearchPage} / {delSearchTotalPages}</span>
                      <Button size="sm" variant="outline" disabled={delSearchPage >= delSearchTotalPages} onClick={() => handleDelSearch(delSearchPage + 1)} className="h-7 text-xs">
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {/* ===== Tab 2: বছরভিত্তিক ডিলিট ===== */}
            <TabsContent value="year" className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                <p className="text-xs text-red-700">সতর্কতা! বছরভিত্তিক ডিলিটে মিলের হিসাব, বিল, জমা সব মুছে যাবে। তবে <strong>সদস্যের মূল তথ্য (নাম, আইডি, মোবাইল, পদবী)</strong> থেকে যাবে এবং পূর্ব ব্যালেন্স শূন্য (০) ধরা হবে।</p>
              </div>

              {/* সার্চ ফর্ম */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="space-y-0.5">
                  <label className="text-xs font-medium text-slate-600">আইডি / নাম / মোবাইল *</label>
                  <div className="relative">
                    <Input placeholder="নাম / 55072 / 01515690200" value={delYearQuery} onChange={e => { setDelYearQuery(bnToEn(e.target.value)); fetchDelSuggestions(bnToEn(e.target.value), setDelYearSuggestions, setDelYearSuggestOpen); }}
                      onKeyDown={e => e.key === 'Enter' && handleDelYearPreview()} onBlur={() => setTimeout(() => setDelYearSuggestOpen(false), 200)} className="h-8 text-sm" />
                    {delYearSuggestOpen && delYearSuggestions.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                        {delYearSuggestions.map((u, i) => (
                          <button key={i} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-red-50 border-b border-slate-100 last:border-0 transition-colors"
                            onMouseDown={e => { e.preventDefault(); setDelYearQuery(u.officeId || u.name); setDelYearSuggestOpen(false); setDelYearSuggestions([]); }}>
                            <span className="font-medium text-slate-800">{u.name}</span>
                            {u.designation && <span className="text-blue-500 ml-1">[{u.designation}]</span>}
                            <span className="text-slate-400 ml-2">{u.officeId}</span>
                            {u.mobile && <span className="text-slate-400 ml-1">{formatMobile(u.mobile)}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <label className="text-xs font-medium text-slate-600">বছর *</label>
                  <Input type="number" placeholder="2025" value={delYearYear} onChange={e => setDelYearYear(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleDelYearPreview()} className="h-8 text-sm" />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleDelYearPreview} disabled={delYearPreviewLoading || !delYearQuery.trim() || !delYearYear}
                    className="w-full h-8 bg-red-600 hover:bg-red-700 text-white text-sm gap-1">
                    {delYearPreviewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                    প্রিভিউ দেখুন
                  </Button>
                </div>
              </div>

              {/* প্রিভিউ */}
              {delYearPreview && (
                <div className="space-y-3">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <Database className="h-4 w-4 text-slate-600" />
                      মোট {delYearPreview.totalEntries}টি এন্ট্রি পাওয়া গেছে
                    </div>
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs">
                      <span className="text-amber-700 font-medium">{delYearPreview.willZeroOutCount} জনের</span>
                      <span className="text-amber-600"> মিলের হিসাব, বিল, জমা শূন্য হবে</span>
                      <p className="text-amber-500 mt-0.5">(নাম, আইডি, মোবাইল, পদবী থাকবে; পূর্ব ব্যালেন্স = ০)</p>
                    </div>
                  </div>

                  {/* বিস্তারিত লিস্ট */}
                  <div className="border rounded-lg overflow-hidden">
                    <div className="max-h-48 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0 z-10">
                          <tr className="border-b">
                            <th className="px-3 py-1.5 text-left font-medium text-slate-600">নাম</th>
                            <th className="px-3 py-1.5 text-left font-medium text-slate-600">পদবী</th>
                            <th className="px-3 py-1.5 text-left font-medium text-slate-600">মোবাইল নম্বর</th>
                            <th className="px-3 py-1.5 text-right font-medium text-slate-600">এন্ট্রি সংখ্যা</th>
                            <th className="px-3 py-1.5 text-center font-medium text-slate-600">অবস্থা</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {delYearPreview.officeIds.map((detail, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="px-3 py-1.5 text-slate-700">{detail.name}</td>
                              <td className="px-3 py-1.5 text-slate-500">{detail.designation || '—'}</td>
                              <td className="px-3 py-1.5 text-slate-700">{detail.mobile ? formatMobile(detail.mobile) : '—'}</td>
                              <td className="px-3 py-1.5 text-right text-slate-700">{detail.entryCount}টি</td>
                              <td className="px-3 py-1.5 text-center">
                                <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300">
                                  মিল/টাকা শূন্য হবে
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {delYearPasswordStep && !delYearDeleteLoading && (
                    <div className="space-y-3 p-4 bg-white border-2 border-red-200 rounded-xl">
                      <div className="flex items-center gap-2">
                        <Lock className="h-5 w-5 text-red-500" />
                        <p className="text-sm font-semibold text-slate-700">Admin পাসওয়ার্ড দিন</p>
                      </div>
                      <div className="space-y-2">
                        <div className="relative">
                          <Input
                            type={delYearShowPwd ? 'text' : 'password'}
                            placeholder="Admin পাসওয়ার্ড লিখুন"
                            value={delYearPassword}
                            onChange={(e) => { setDelYearPassword(e.target.value); setDelYearPasswordError(''); }}
                            onKeyDown={(e) => e.key === 'Enter' && handleDelYearPasswordVerify()}
                            className="h-10 text-sm border-red-200 focus:border-red-400 pr-9"
                          />
                          <button type="button" onClick={() => setDelYearShowPwd(p => !p)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{delYearShowPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                        </div>
                        {delYearPasswordError && (
                          <p className="text-xs text-red-600 font-medium">{delYearPasswordError}</p>
                        )}
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={() => { setDelYearPasswordStep(false); setDelYearPassword(''); }} className="h-9 text-sm">বাতিল</Button>
                          <Button onClick={handleDelYearPasswordVerify} className="flex-1 h-9 bg-red-600 hover:bg-red-700 text-white text-sm gap-1">
                            <KeyRound className="h-4 w-4" /> ভেরিফাই করুন
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {!delYearPasswordStep && (
                    <div className="flex items-center gap-2 justify-end">
                      <Button variant="outline" onClick={() => { setDelYearPreview(null); }}>বাতিল</Button>
                      <Button variant="destructive" onClick={handleDelYearDelete}
                        className="gap-1">
                        <Trash2 className="h-4 w-4" />
                        নিশ্চিত করে ডিলিট করুন
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ===== Tab 3: All Delete — পুরা ডাটাবেজ ফাকা ===== */}
            <TabsContent value="all" className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-300 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-red-700">সতর্কতা! এটি একটি চরম পদক্ষেপ!</p>
                  <p className="text-xs text-red-600">"All Delete" ক্লিক করলে পুরা ডাটাবেজ ফাকা হয়ে যাবে। সকল সদস্যের নাম, পদবী, মোবাইল নম্বর, মিল এন্ট্রি, টাকা জমা, ব্যালেন্স — সব কিছু চিরতরে মুছে যাবে। এই কাজ পূর্বাবস্থায় ফিরিয়ে আনা সম্ভব নয়!</p>
                </div>
              </div>

              {/* Step 1: Password input */}
              {!allDeleteVerified && (
                <div className="space-y-3 p-4 bg-white border-2 border-red-200 rounded-xl">
                  <div className="flex items-center gap-2">
                    <Lock className="h-5 w-5 text-red-500" />
                    <p className="text-sm font-semibold text-slate-700">Admin পাসওয়ার্ড দিন</p>
                  </div>
                  <div className="space-y-2">
                    <div className="relative">
                      <Input
                        type={allDeleteShowPwd ? 'text' : 'password'}
                        placeholder="Admin পাসওয়ার্ড লিখুন"
                        value={allDeletePassword}
                        onChange={(e) => { setAllDeletePassword(e.target.value); setAllDeletePasswordError(''); }}
                        onKeyDown={(e) => e.key === 'Enter' && handleAllDeletePasswordVerify()}
                        className="h-10 text-sm border-red-200 focus:border-red-400 pr-9"
                      />
                      <button type="button" onClick={() => setAllDeleteShowPwd(p => !p)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{allDeleteShowPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                    </div>
                    {allDeletePasswordError && (
                      <p className="text-xs text-red-600 font-medium">{allDeletePasswordError}</p>
                    )}
                    <Button onClick={handleAllDeletePasswordVerify} className="w-full h-9 bg-red-600 hover:bg-red-700 text-white text-sm gap-1">
                      <KeyRound className="h-4 w-4" /> ভেরিফাই করুন
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 2: Verified — show delete button with warning */}
              {allDeleteVerified && (
                <div className="space-y-4 p-4 bg-gradient-to-br from-red-50 to-orange-50 border-2 border-red-300 rounded-xl">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <p className="text-sm font-semibold text-green-700">পাসওয়ার্ড ভেরিফাইড!</p>
                  </div>
                  <div className="flex items-start gap-2 p-3 bg-red-100 border border-red-300 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-700 font-medium">আপনি কি সত্যিই পুরা ডাটাবেজ ডিলিট করতে চান? এই কাজের পর কোনো ডাটা ফিরে পাওয়া যাবে না!</p>
                  </div>
                  <Button
                    variant="destructive"
                    onClick={handleAllDeleteExecute}
                    disabled={allDeleteLoading}
                    className="w-full h-12 bg-red-700 hover:bg-red-800 text-white text-base font-bold gap-2 rounded-lg shadow-lg animate-pulse">
                    {allDeleteLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
                    পুরা ডাটাবেজ ডিলিট হবে
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { setAllDeleteVerified(false); setAllDeletePassword(''); }}
                    className="w-full h-8 text-xs border-slate-300 text-slate-600 hover:bg-slate-50">
                    বাতিল
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* ===== সদস্য ইমপোর্ট Dialog — গুগল শিট থেকে অফিস আইডি, নাম, পদবী, মোবাইল ইমপোর্ট ===== */}
      <Dialog open={memberImportOpen} onOpenChange={(open) => { if (!open) setMemberImportOpen(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" /> সদস্য ইমপোর্ট
            </DialogTitle>
          </DialogHeader>

          {/* স্টেপ ১: Google Sheet URL ইনপুট */}
          {memberImportStep === 'url' && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700">Google Sheet URL</label>
                <Input
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                  value={memberImportUrl}
                  onChange={e => setMemberImportUrl(e.target.value)}
                  className="mt-1"
                  onKeyDown={e => { if (e.key === 'Enter') handleMemberImportLoadSheets(); }}
                />
                <p className="text-xs text-slate-500 mt-1">Google Sheets-এর URL পেস্ট করুন। শিটটি পাবলিক হতে হবে।</p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm font-medium text-blue-800 mb-2">কিভাবে কাজ করে:</p>
                <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
                  <li>গুগল শিট থেকে অফিস আইডি, নাম, পদবী, মোবাইল নম্বর ইমপোর্ট হবে</li>
                  <li>যদি অফিস আইডি ডাটাবেজে <strong>আগে থেকে থাকে</strong> → নাম, পদবী, মোবাইল আপডেট হবে</li>
                  <li>যদি অফিস আইডি <strong>নতুন হয়</strong> → নতুন সদস্য হিসেবে সব তথ্য সহ যোগ হবে</li>
                  <li>কলামের নাম বাংলা/ইংরেজি যেকোনো ভাষায় থাকলেও অটো ম্যাপ হবে</li>
                </ul>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm font-medium text-amber-800 mb-1">সাপোর্টেড কলাম নাম (উদাহরণ):</p>
                <div className="grid grid-cols-2 gap-1 text-xs text-amber-700">
                  <span>• Office ID / অফিস আইডি</span>
                  <span>• Name / নাম</span>
                  <span>• Designation / পদবী</span>
                  <span>• Mobile / মোবাইল</span>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setMemberImportOpen(false)}>বাতিল</Button>
                <Button
                  onClick={handleMemberImportLoadSheets}
                  disabled={memberImportLoading || !memberImportUrl.trim()}
                  className="bg-blue-600 hover:bg-blue-700 gap-1"
                >
                  {memberImportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  পরবর্তী
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* স্টেপ ২: শীট সিলেক্ট করা */}
          {memberImportStep === 'select' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">আপনার Google Sheet-এ যে ট্যাব থেকে ডাটা নিতে চান সিলেক্ট করুন:</p>

              {memberImportSheets.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {memberImportSheets.map(s => (
                    <Button
                      key={s.gid}
                      variant={memberImportSelectedSheet === s.gid ? 'default' : 'outline'}
                      onClick={() => setMemberImportSelectedSheet(s.gid)}
                      className={`gap-1 text-sm ${memberImportSelectedSheet === s.gid ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                    >
                      <Database className="h-3 w-3" /> {s.name}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">কোনো ট্যাব পাওয়া যায়নি।</p>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setMemberImportStep('url')}>পেছনে</Button>
                <Button variant="outline" onClick={() => setMemberImportOpen(false)}>বাতিল</Button>
                <Button
                  onClick={handleMemberImportPreview}
                  disabled={memberImportLoading || !memberImportSelectedSheet}
                  className="bg-blue-600 hover:bg-blue-700 gap-1"
                >
                  {memberImportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  প্রিভিউ দেখুন
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* স্টেপ ৩: কলাম সিলেক্ট ও প্রিভিউ */}
          {memberImportStep === 'preview' && memberImportPreview && (
            <div className="space-y-4">
              {/* শিটের কলাম থেকে সিলেক্ট করুন */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm font-medium text-blue-800 mb-1">📌 কলাম সিলেক্ট করুন</p>
                <p className="text-xs text-blue-600 mb-3">প্রতিটি ফিল্ডের জন্য শিট থেকে সঠিক কলাম বেছে নিন:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    { field: 'officeId', label: 'অফিস আইডি', icon: '🔐', required: true },
                    { field: 'name', label: 'নাম', icon: '👤', required: false },
                    { field: 'designation', label: 'পদবী', icon: '💼', required: false },
                    { field: 'mobile', label: 'মোবাইল', icon: '📱', required: false },
                  ].map(f => {
                    // এই ফিল্ডে কোন শিট কলাম ম্যাপ করা আছে
                    const selectedCol = Object.entries(memberColumnMap).find(([, v]) => v === f.field)?.[0] || '';
                    return (
                      <div key={f.field} className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-700 flex items-center gap-1">
                          {f.icon} {f.label}
                          {f.required && <span className="text-red-500">*</span>}
                        </label>
                        <select
                          value={selectedCol}
                          onChange={e => {
                            const newCol = e.target.value;
                            setMemberColumnMap(prev => {
                              const next: Record<string, string> = {};
                              // পুরনো ম্যাপিং থেকে এই ফিল্ডের পুরনো কলাম সরান
                              for (const [k, v] of Object.entries(prev)) {
                                if (v !== f.field) next[k] = v;
                              }
                              // নতুন কলাম ম্যাপ করুন
                              if (newCol) next[newCol] = f.field;
                              return next;
                            });
                          }}
                          className={`text-sm px-2 py-1.5 rounded-md border cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                            selectedCol
                              ? 'bg-white border-blue-400 text-slate-800 font-medium'
                              : 'bg-white border-slate-300 text-slate-400'
                          }`}
                        >
                          <option value="">— সিলেক্ট করুন —</option>
                          {(memberImportPreview.headers || []).map((h: string, i: number) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ম্যাপিং সারাংশ */}
              {Object.keys(memberColumnMap).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(memberColumnMap).map(([col, field]) => {
                    const fieldLabel: Record<string, string> = {
                      officeId: 'অফিস আইডি', name: 'নাম', designation: 'পদবী',
                      mobile: 'মোবাইল',
                    };
                    return (
                      <span key={col} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-300">
                        {fieldLabel[field] || field}: <span className="font-bold">{col}</span>
                      </span>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    মোট {memberImportPreview.totalRows} রো, বৈধ {memberImportPreview.validRows} জন
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => setMemberImportStep('select')}>
                  <ChevronLeft className="h-3 w-3" /> শীট পরিবর্তন
                </Button>
              </div>

              {/* প্রিভিউ টেবিল — শুধু সিলেক্ট করা কলামগুলো */}
              {Object.keys(memberColumnMap).length > 0 ? (
                <div className="border rounded-lg overflow-auto max-h-72">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left">#</th>
                        {Object.entries(memberColumnMap).map(([col]) => {
                          return (
                            <th key={col} className="px-2 py-1.5 text-left whitespace-nowrap">
                              {col}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {(memberImportPreview.rawPreview || []).map((row: any, i: number) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                          {Object.keys(memberColumnMap).map(col => (
                            <td key={col} className="px-2 py-1 whitespace-nowrap">{row[col] || '-'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="border rounded-lg p-6 text-center text-sm text-slate-500">
                  উপরের ফিল্ড থেকে কলাম সিলেক্ট করুন, এখানে প্রিভিউ দেখাবে
                </div>
              )}

              {memberImportPreview.validRows > 20 && (
                <p className="text-xs text-center text-slate-500">প্রথম ২০টি দেখানো হচ্ছে। মোট {memberImportPreview.validRows} জন ইমপোর্ট হবে।</p>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setMemberImportOpen(false)}>বাতিল</Button>
                <Button
                  onClick={handleMemberImportSave}
                  disabled={memberImportSaving || !Object.values(memberColumnMap).includes('officeId')}
                  className="bg-emerald-600 hover:bg-emerald-700 gap-1"
                >
                  {memberImportSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                  {memberImportSaving ? 'ইমপোর্ট হচ্ছে...' : `ইমপোর্ট করুন (${memberImportPreview.validRows})`}
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* স্টেপ ৪: ফলাফল */}
          {memberImportStep === 'result' && memberImportResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border p-3 text-center bg-green-50">
                  <p className="text-2xl font-bold text-green-600">{memberImportResult.created || 0}</p>
                  <p className="text-xs text-slate-600">নতুন যোগ</p>
                </div>
                <div className="rounded-lg border p-3 text-center bg-blue-50">
                  <p className="text-2xl font-bold text-blue-600">{memberImportResult.updated || 0}</p>
                  <p className="text-xs text-slate-600">আপডেট</p>
                </div>
                <div className="rounded-lg border p-3 text-center bg-orange-50">
                  <p className="text-2xl font-bold text-orange-600">{memberImportResult.skipped || 0}</p>
                  <p className="text-xs text-slate-600">বাদ পড়েছে</p>
                </div>
              </div>

              {/* বিস্তারিত তালিকা */}
              {memberImportResult.details && memberImportResult.details.length > 0 && (
                <div className="border rounded-lg overflow-auto max-h-48">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left">অফিস আইডি</th>
                        <th className="px-2 py-1.5 text-left">নাম</th>
                        <th className="px-2 py-1.5 text-left">অবস্থা</th>
                      </tr>
                    </thead>
                    <tbody>
                      {memberImportResult.details.map((d: any, i: number) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          <td className="px-2 py-1 font-mono">{d.officeId}</td>
                          <td className="px-2 py-1">{d.name}</td>
                          <td className="px-2 py-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                              d.action === 'নতুন যোগ'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}>
                              {d.action}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {memberImportResult.errors && memberImportResult.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-red-700 mb-1">সমস্যা:</p>
                  {memberImportResult.errors.map((e: string, i: number) => (
                    <p key={i} className="text-xs text-red-600">{e}</p>
                  ))}
                </div>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => { setMemberImportStep('url'); setMemberImportPreview(null); setMemberImportResult(null); setMemberColumnMap({}); }}
                  className="gap-1"
                >
                  <RefreshCw className="h-3 w-3" /> আবার ইমপোর্ট
                </Button>
                <Button onClick={() => setMemberImportOpen(false)}>
                  সম্পন্ন
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* জেনেরিক কনফার্মেশন Dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={(open) => { if (!open) setConfirmDialog(prev => ({ ...prev, open: false })); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" /> নিশ্চিত করুন
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-700">{confirmDialog.message}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))}>বাতিল</Button>
            <Button
              variant="destructive"
              onClick={() => {
                confirmDialog.onConfirm();
                setConfirmDialog(prev => ({ ...prev, open: false }));
              }}
              className="gap-1 justify-start"
            >
              <Trash2 className="h-4 w-4" />
              ডিলিট
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== SEARCH SECTION ====================
function SearchSection() {
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(currentYear);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  // ===== কোল্যাপসিবল state =====
  const [showMealDetails, setShowMealDetails] = useState(false);
  const [showDepositDetails, setShowDepositDetails] = useState(false);
  // ===== অটো-ফিল state =====
  const [searchLookup, setSearchLookup] = useState<{ officeId: string; name: string; mobile: string; designation?: string } | null>(null);
  const [searchLookupSuggestions, setSearchLookupSuggestions] = useState<{ officeId: string; name: string; mobile: string; designation?: string }[]>([]);
  const [searchLookupDropdownOpen, setSearchLookupDropdownOpen] = useState(false);
  const [searchLookupLoading, setSearchLookupLoading] = useState(false);
  const searchLookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ===== অটো রিফ্রেশ: অন্য কোথাও ডাটা পরিবর্তন হলে এখানেও আপডেট =====
  const lastSearchParams = useRef<{ query: string; month: string; year: string } | null>(null);
  useEffect(() => {
    const handler = () => {
      // আগে সার্চ করা থাকলে সেই প্যারামিটারে আবার সার্চ করুন
      if (lastSearchParams.current) {
        const { query: q, month: m, year: y } = lastSearchParams.current;
        if (q && m && y) {
          setLoading(true); setResult(null); setShowMealDetails(false); setShowDepositDetails(false);
          (async () => {
            try {
              const params = new URLSearchParams({ action: 'search', query: bnToEn(q), month: m, year: y });
              const res = await fetch(`/api/entries?${params}`);
              const data = await res.json();
              setResult(data);
            } catch { setResult({ success: false, error: 'নেটওয়ার্ক এরর' }); }
            finally { setLoading(false); }
          })();
        }
      }
    };
    window.addEventListener('meal-data-changed', handler);
    return () => window.removeEventListener('meal-data-changed', handler);
  }, []);

  // ===== fmtDate — তারিখ ফরম্যাট (Bengali) =====
  const fmtDate = (d: string) => {
    try {
      const datePart = (d || '').substring(0, 10);
      if (!datePart || datePart.length < 10 || !datePart.includes('-')) return d;
      const parts = datePart.split('-');
      const y = parseInt(parts[0]) || 0;
      const m = parseInt(parts[1]) || 1;
      const day = parseInt(parts[2]) || 1;
      const bnMonths = ['জানু', 'ফেব', 'মার্চ', 'এপ্রি', 'মে', 'জুন', 'জুলা', 'আগ', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'];
      return `${day.toLocaleString('bn-BD')} ${bnMonths[m - 1] || m}, ${y.toLocaleString('bn-BD')}`;
    } catch { return d; }
  };

  // ===== অটো-লুকআপ — ড্রপডাউন সাজেশন =====
  const handleQueryChange = (val: string) => {
    setQuery(val);
    setSearchLookup(null);
    setSearchLookupSuggestions([]);
    setSearchLookupDropdownOpen(false);
    if (!val || val.length < 2) return;
    setSearchLookupLoading(true);
    if (searchLookupTimer.current) clearTimeout(searchLookupTimer.current);
    searchLookupTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/entries?action=lookup&query=${encodeURIComponent(bnToEn(val.trim()))}`);
        const data = await res.json();
        if (data.success && data.users && data.users.length > 0) {
          const users = data.users.map((u: any) => ({
            officeId: u.officeId,
            name: u.name || '',
            mobile: formatMobile(u.mobile || ''),
            designation: u.designation || ''
          }));
          setSearchLookupSuggestions(users);
          setSearchLookupDropdownOpen(true);
        }
      } catch { /* silent */ }
      setSearchLookupLoading(false);
    }, 500);
  };

  const handleLookupSelect = (user: { officeId: string; name: string; mobile: string; designation?: string }) => {
    setSearchLookup(user);
    setSearchLookupSuggestions([]);
    setSearchLookupDropdownOpen(false);
    setQuery(user.officeId);
  };

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !month || !year) {
      setResult({ success: false, error: 'মাস, বছর এবং আইডি/মোবাইল তিনটি ঘর পূরণ করুন' });
      return;
    }
    lastSearchParams.current = { query: query.trim(), month, year };
    setLoading(true); setResult(null); setSearchLookup(null); setShowMealDetails(false); setShowDepositDetails(false);
    try {
      const params = new URLSearchParams({ action: 'search', query: bnToEn(query.trim()), month, year });
      const res = await fetch(`/api/entries?${params}`);
      const data = await res.json();
      setResult(data);
      if (data.success) {
        setQuery('');
      }
    } catch { setResult({ success: false, error: 'নেটওয়ার্ক এরর' }); }
    finally { setLoading(false); }
  }, [query, month, year]);

  const netBalance = result?.summary ? result.summary.total_deposit - result.summary.total_bill : 0;

  return (
    <div className="space-y-4">
      {/* Search Card */}
      <Card className="shadow-md border-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-emerald-600" /> ব্যক্তিগত তথ্যাবলী জানতে
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-start">
            <div className="space-y-0.5">
              <label className="text-xs font-medium text-slate-600">নাম/আইডি/মোবাইল *</label>
              <div className="relative">
                <Input placeholder="নাম, আইডি বা মোবাইল লিখুন" value={query} onChange={e => handleQueryChange(e.target.value)}
                  onFocus={() => searchLookupSuggestions.length > 0 && setSearchLookupDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setSearchLookupDropdownOpen(false), 200)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()} className="h-8 text-sm" />
                {searchLookupLoading && <Loader2 className="h-3 w-3 animate-spin absolute right-2 top-2 text-slate-400" />}
                {/* ড্রপডাউন সাজেশন */}
                {searchLookupDropdownOpen && searchLookupSuggestions.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {searchLookupSuggestions.map((u, i) => (
                      <button
                        key={i}
                        className="w-full px-3 py-2 text-left text-xs hover:bg-emerald-50 border-b last:border-b-0 transition-colors"
                        onMouseDown={() => handleLookupSelect(u)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800">{u.name}</span>
                          {u.designation && <span className="text-slate-400 text-[10px]">({u.designation})</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                          <span>আইডি: {u.officeId}</span>
                          {u.mobile && <span>• মোবাইল: {u.mobile}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* সিলেক্টেড ইউজার — টিকমার্ক সহ বিস্তারিত */}
              {searchLookup && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 mt-1 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    <span className="text-xs font-semibold text-emerald-800">{searchLookup.name}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5 text-[10px] text-emerald-700">
                    {searchLookup.designation && <span>পদবী: {searchLookup.designation}</span>}
                    <span>আইডি: {searchLookup.officeId}</span>
                    {searchLookup.mobile && <span>মোবাইল: {searchLookup.mobile}</span>}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-0.5">
              <label className="text-xs font-medium text-slate-600">মাস *</label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="মাস" /></SelectTrigger>
                <SelectContent>{MONTHS_NO_ALL.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-0.5">
              <label className="text-xs font-medium text-slate-600">বছর *</label>
              <Input type="number" placeholder="2026" value={year} onChange={e => setYear(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()} className="h-8 text-sm" />
            </div>
            <div className="flex items-start mt-5">
              <Button onClick={handleSearch} disabled={loading}
                className="w-full h-7 bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-0.5">
                {loading ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <><Search className="h-3 w-3" />সার্চ</>}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      {/* Error */}
      {result && !result.success && (
        <Card className="border-red-200 bg-red-50 shadow-md">
          <CardContent className="py-4"><p className="text-red-700 text-center font-medium">{result.error}</p></CardContent>
        </Card>
      )}
      {/* No data for this month */}
      {result && result.success && result.entries && result.entries.length === 0 && (
        <Card className="border-amber-200 bg-amber-50 shadow-md">
          <CardContent className="py-4"><p className="text-amber-700 text-center font-medium">এই মাসের কোনো ডাটা নেই</p></CardContent>
        </Card>
      )}
      {/* Results */}
      {result && result.success && result.user && result.summary && result.entries && result.entries.length > 0 && (
        <div className="space-y-3">
          {/* Employee Info — Single Row + Meal Prices */}
          <Card className="shadow-md border-0">
            <CardHeader className="pb-2 bg-slate-50 rounded-t-lg">
              <CardTitle className="text-base flex items-center gap-2"><User className="h-5 w-5 text-slate-600" />কর্মচারীর বিবরণ</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              {/* নাম, অফিস আইডি, মোবাইল — এক সারিতে */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
                  <p className="text-[10px] text-emerald-600 font-medium">নাম</p>
                  <p className="text-xs font-bold text-slate-800 mt-0.5 truncate">{result.user.name || '—'}</p>
                </div>
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
                  <p className="text-[10px] text-emerald-600 font-medium">অফিস আইডি</p>
                  <p className="text-xs font-bold text-slate-800 mt-0.5">{result.user.id}</p>
                </div>
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
                  <p className="text-[10px] text-emerald-600 font-medium">মোবাইল</p>
                  <p className="text-xs font-bold text-slate-800 mt-0.5">{formatMobile(result.user.mobile || '—')}</p>
                </div>
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
                  <p className="text-[10px] text-emerald-600 font-medium">পদবী</p>
                  <p className="text-xs font-bold text-slate-800 mt-0.5 truncate">{(result.user as any).designation || (result.entries[0] as any).designation || '—'}</p>
                </div>
              </div>
              {/* Meal Prices */}
              {result.prices && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-2">এই মাসের খাবারের দাম <Badge variant="secondary" className="bg-amber-200 text-amber-800 text-[10px] ml-1">{result.searchParams?.month} {result.searchParams?.year}</Badge></p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {[
                      { label: 'সকাল নাস্তা', price: result.prices.breakfastPrice },
                      { label: 'দুপুর মিল', price: result.prices.lunchPrice },
                      { label: 'সকাল স্পেশাল', price: result.prices.morningSpecial },
                      { label: 'দুপুর স্পেশাল', price: result.prices.lunchSpecial },
                    ].map(p => (
                      <div key={p.label} className="p-3 rounded-lg border bg-white border-emerald-200 text-center">
                        <p className="text-xs text-slate-500 leading-tight">{p.label}</p>
                        <p className="text-base font-bold text-emerald-700 mt-1">{p.price ? `${p.price} Tk` : '—'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          {/* Financial Summary — Compact */}
          <Card className="shadow-md border-0">
            <CardHeader className="pb-2 bg-slate-50 rounded-t-lg">
              <CardTitle className="text-base flex items-center gap-2"><Wallet className="h-5 w-5 text-slate-600" />আর্থিক সামারি</CardTitle>
            </CardHeader>
            <CardContent className="pt-3 space-y-2">
              <div className="flex justify-between items-center p-2 bg-red-50 rounded-lg">
                <span className="text-xs font-medium text-slate-700">এই মাসের মোট বিল</span>
                <span className="text-sm font-bold text-red-700">{result.summary.total_bill} টাকা</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-emerald-50 rounded-lg">
                <span className="text-xs font-medium text-slate-700">এই মাসের মোট জমা</span>
                <span className="text-sm font-bold text-emerald-700">{result.summary.total_deposit} টাকা</span>
              </div>
              <Separator />
              <div className="flex justify-between items-center p-2 bg-amber-50 rounded-lg">
                <span className="text-xs font-bold text-slate-700">মাসিক অবস্থা (জমা - বিল)</span>
                <span className={`text-sm font-bold ${netBalance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {netBalance >= 0 ? '+' : ''}{netBalance} টাকা
                </span>
              </div>
              {netBalance > 0 && (
                <div className="flex items-start gap-2 p-2 bg-blue-50 rounded-lg border border-blue-200">
                  <AlertTriangle className="h-3.5 w-3.5 text-blue-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-blue-700">
                    <strong>অগ্রিম জমা:</strong> এই মাসে আপনি {netBalance} টাকা বেশি জমা দিয়েছেন। এই টাকা পরের মাসের মিলের বিল থেকে কাটা যাবে।
                  </p>
                </div>
              )}
              {netBalance < 0 && (
                <div className="flex items-start gap-2 p-2 bg-red-50 rounded-lg border border-red-200">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-700">
                    <strong>বকেয়া:</strong> এই মাসে {Math.abs(netBalance)} টাকা কম জমা দেওয়া হয়েছে। এই টাকা পরের মাসের বিলে যোগ হবে।
                  </p>
                </div>
              )}
              <Separator />
              <div className={`flex justify-between items-center p-3 rounded-lg ${result.latestBalance >= 0 ? 'bg-emerald-100' : 'bg-red-100'}`}>
                <span className="text-sm font-bold text-slate-800">বর্তমান ব্যালেন্স</span>
                <span className={`text-lg font-bold ${result.latestBalance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {result.latestBalance >= 0 ? '+' : ''}{result.latestBalance} টাকা
                </span>
              </div>
            </CardContent>
          </Card>
          {/* Meal Details — Collapsible */}
          <Card className="shadow-md border-0">
            <button
              onClick={() => setShowMealDetails(!showMealDetails)}
              className="w-full flex items-center justify-between p-4 bg-slate-50 rounded-t-lg hover:bg-slate-100 transition-colors"
            >
              <span className="text-base flex items-center gap-2 font-semibold text-slate-800">
                <UtensilsCrossed className="h-5 w-5 text-slate-600" />মিলের বিবরণী
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="bg-emerald-200 text-emerald-800 text-[10px]">{result.entries.filter((e: any) => (e.breakfastCount || 0) > 0 || (e.lunchCount || 0) > 0 || (e.morningSpecial || 0) > 0 || (e.lunchSpecial || 0) > 0).length}টি এন্ট্রি</Badge>
                {showMealDetails ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
              </div>
            </button>
            {showMealDetails && (
              <CardContent className="pt-3">
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="py-2 px-2 text-left">তারিখ</th>
                        <th className="py-2 px-2 text-center">সকাল</th>
                        <th className="py-2 px-2 text-center">দুপুর</th>
                        <th className="py-2 px-2 text-center">সকাল স্পেশাল</th>
                        <th className="py-2 px-2 text-center">দুপুর স্পেশাল</th>
                        <th className="py-2 px-2 text-right">মোট বিল</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...result.entries].filter((e: any) => (e.breakfastCount || 0) > 0 || (e.lunchCount || 0) > 0 || (e.morningSpecial || 0) > 0 || (e.lunchSpecial || 0) > 0).sort((a: any, b: any) => String(a.entryDate || '').localeCompare(String(b.entryDate || ''))).map((e: any) => (
                        <tr key={e.id} className="border-t hover:bg-slate-50">
                          <td className="py-2 px-2 text-slate-600">{fmtDate(String(e.entryDate || ''))}</td>
                          <td className="py-2 px-2 text-center">{e.breakfastCount || 0}</td>
                          <td className="py-2 px-2 text-center">{e.lunchCount || 0}</td>
                          <td className="py-2 px-2 text-center">{e.morningSpecial || 0}</td>
                          <td className="py-2 px-2 text-center">{e.lunchSpecial || 0}</td>
                          <td className="py-2 px-2 text-right font-bold text-red-600">{Number(e.totalBill) || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            )}
          </Card>
          {/* Deposit Details — Collapsible */}
          <Card className="shadow-md border-0">
            <button
              onClick={() => setShowDepositDetails(!showDepositDetails)}
              className="w-full flex items-center justify-between p-4 bg-slate-50 rounded-t-lg hover:bg-slate-100 transition-colors"
            >
              <span className="text-base flex items-center gap-2 font-semibold text-slate-800">
                <Wallet className="h-5 w-5 text-slate-600" />টাকা জমার বিবরণ
              </span>
              <div className="flex items-center gap-2">
                {(() => {
                  const depositEntries = [...result.entries].filter((e: any) => (e.deposit || 0) > 0);
                  const totalDeposit = depositEntries.reduce((s: number, e: any) => s + (Number(e.deposit) || 0), 0);
                  const totalMealCost = [...result.entries].reduce((s: number, e: any) => s + (Number(e.totalBill) || 0), 0);
                  return (
                    <>
                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 text-[10px]">{depositEntries.length}টি জমা</Badge>
                      <span className="text-[10px] text-emerald-700 font-medium">মোট জমা: {totalDeposit}</span>
                      <span className="text-[10px] text-red-600 font-medium">মোট খরচ: {totalMealCost}</span>
                      <span className={`text-[10px] font-bold ${result.latestBalance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>ব্যালেন্স: {result.latestBalance >= 0 ? '+' : ''}{result.latestBalance}</span>
                    </>
                  );
                })()}
                {showDepositDetails ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
              </div>
            </button>
            {showDepositDetails && (
              <CardContent className="pt-3">
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="py-2 px-2 text-left">তারিখ</th>
                        <th className="py-2 px-2 text-right">জমার পরিমাণ</th>
                        <th className="py-2 px-2 text-right">জমার আগে</th>
                        <th className="py-2 px-2 text-right">জমার পর</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...result.entries].filter((e: any) => (e.deposit || 0) > 0).sort((a: any, b: any) => String(a.entryDate || '').localeCompare(String(b.entryDate || ''))).map((e: any) => (
                        <tr key={e.id} className="border-t hover:bg-slate-50">
                          <td className="py-2 px-2 text-slate-600">{fmtDate(String(e.entryDate || ''))}</td>
                          <td className="py-2 px-2 text-right text-emerald-600 font-medium">{Number(e.deposit) || 0}</td>
                          <td className="py-2 px-2 text-right text-slate-500">{Number(e.prevBalance || 0) >= 0 ? '+' : ''}{Number(e.prevBalance) || 0}</td>
                          <td className={`py-2 px-2 text-right font-bold ${Number(e.curBalance || 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                            {Number(e.curBalance || 0) >= 0 ? '+' : ''}{Number(e.curBalance) || 0}
                          </td>
                      </tr>
                    ))}
                  </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-100">
                        <td className="py-2 px-2 text-sm font-bold text-slate-800">মোট জমা</td>
                        <td className="py-2 px-2 text-right text-base font-bold text-emerald-700">{[...result.entries].filter((e: any) => (e.deposit || 0) > 0).reduce((s: number, e: any) => s + (Number(e.deposit) || 0), 0)}</td>
                        <td colSpan={2} className="py-2 px-2 text-sm font-bold text-slate-800 text-right">বর্তমান মোট ব্যালেন্স</td>
                        <td className={`py-2 px-2 text-right text-base font-bold ${result.latestBalance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          {result.latestBalance >= 0 ? '+' : ''}{result.latestBalance}
                        </td>
                      </tr>
                    </tfoot>
                </table>
              </div>
            </CardContent>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

// ==================== PASSWORD DIALOG ====================
function PasswordDialog({ onSuccess, onClose }: { onSuccess: (newPassword?: string) => void; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [loginShowPwd, setLoginShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Forgot password state
  const [showForgot, setShowForgot] = useState(false);
  const [resetStep, setResetStep] = useState<'email' | 'otp'>('email');
  const [resetEmail, setResetEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetShowPwd1, setResetShowPwd1] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetShowPwd2, setResetShowPwd2] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  const [resetError, setResetError] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      // সার্ভারে পাসওয়ার্ড যাচাই করুন — পাসওয়ার্ড response এ আসবে না
      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify_password', password })
      });
      const data = await res.json();
      if (data.success && data.token) {
        sessionStorage.setItem('adminAuth', 'true');
        sessionStorage.setItem('adminToken', data.token);
        sessionStorage.setItem('adminPwd', password);
        onSuccess();
      } else {
        setError(data.error || 'ভুল পাসওয়ার্ড!');
      }
    } catch {
      setError('সার্ভারে সমস্যা হয়েছে');
    }
    setLoading(false);
  };

  const handleSendOtp = async () => {
    if (!resetEmail.trim()) {
      setResetError('ইমেইল দিন');
      return;
    }
    setResetLoading(true);
    setResetError('');
    setResetMsg('');
    try {
      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_code', email: resetEmail.trim() })
      });
      const data = await res.json();
      if (data.success) {
        if (data.otpSent) {
          // ইমেইলে কোড পাঠানো হয়েছে — কোড দেখাব না
          setResetMsg('✅ ভেরিফিকেশন কোড আপনার ইমেইলে পাঠানো হয়েছে। ইনবক্স চেক করুন।');
        } else {
          // ফলব্যাক — ইমেইল কাজ করেনি, টেস্ট কোড দেখাব
          setResetMsg(`⚠️ ইমেইল পাঠানো যায়নি। টেস্ট কোড: ${data.otp}`);
          setGeneratedOtp(data.otp || '');
        }
        setResetStep('otp');
      } else {
        setResetError(data.error || 'কোড পাঠানো যায়নি');
      }
    } catch {
      setResetError('নেটওয়ার্ক এরর');
    }
    setResetLoading(false);
  };

  const handleResetPassword = async () => {
    if (!otpCode || !newPassword || !confirmPassword) {
      setResetError('সব ঘর পূরণ করুন');
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError('পাসওয়ার্ড মিলছে না');
      return;
    }
    if (newPassword.length < 4) {
      setResetError('পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে');
      return;
    }
    setResetLoading(true);
    setResetError('');
    try {
      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify_and_reset', email: resetEmail.trim(), otp: otpCode, newPassword })
      });
      const data = await res.json();
      if (data.success) {
        setResetMsg('পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে! নতুন পাসওয়ার্ড দিয়ে লগইন করুন।');
        setTimeout(() => {
          setShowForgot(false);
          setResetStep('email');
          setResetEmail('');
          setOtpCode('');
          setNewPassword('');
          setConfirmPassword('');
          setResetMsg('');
          setGeneratedOtp('');
          setPassword('');
        }, 2000);
      } else {
        setResetError(data.error || 'পাসওয়ার্ড পরিবর্তন ব্যর্থ');
      }
    } catch {
      setResetError('নেটওয়ার্ক এরর');
    }
    setResetLoading(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {showForgot ? <KeyRound className="h-5 w-5 text-amber-600" /> : <Lock className="h-5 w-5 text-emerald-600" />}
            {showForgot ? 'পাসওয়ার্ড রিসেট' : 'এডমিন পাসওয়ার্ড'}
          </DialogTitle>
        </DialogHeader>

        {!showForgot ? (
          /* ===== লগইন ফর্ম ===== */
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">পাসওয়ার্ড দিন</label>
              <div className="relative">
                <Input type={loginShowPwd ? 'text' : 'password'} placeholder="••••••" value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  className="h-11 pr-9" autoFocus />
                <button type="button" onClick={() => setLoginShowPwd(p => !p)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{loginShowPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
            </div>
            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
            <div className="text-right">
              <button onClick={() => setShowForgot(true)} className="text-xs text-amber-600 hover:text-amber-800 hover:underline font-medium">
                Forgot password?
              </button>
            </div>
          </div>
        ) : (
          /* ===== পাসওয়ার্ড রিসেট ফর্ম ===== */
          <div className="space-y-4">
            <button onClick={() => { setShowForgot(false); setResetStep('email'); setResetMsg(''); setResetError(''); }}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
              <ChevronLeft className="h-3 w-3" /> লগইনে ফিরে যান
            </button>

            {resetStep === 'email' ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">রেজিস্টার্ড ইমেইল</label>
                  <Input type="email" placeholder="email@example.com" value={resetEmail}
                    onChange={e => { setResetEmail(e.target.value); setResetError(''); }}
                    onKeyDown={e => e.key === 'Enter' && handleSendOtp()}
                    className="h-11" autoFocus />
                </div>
                {resetError && <p className="text-sm text-red-600 font-medium">{resetError}</p>}
                {resetMsg && <p className="text-sm text-emerald-600 font-medium">{resetMsg}</p>}
              </>
            ) : (
              <>
                {resetMsg && <p className="text-sm text-emerald-600 font-medium">{resetMsg}</p>}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">ভেরিফিকেশন কোড</label>
                  <Input type="text" placeholder="৬ ডিজিটের কোড" maxLength={6} value={otpCode}
                    onChange={e => { setOtpCode(e.target.value.replace(/\D/g, '')); setResetError(''); }}
                    className="h-11" autoFocus />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">নতুন পাসওয়ার্ড</label>
                  <div className="relative">
                    <Input type={resetShowPwd1 ? 'text' : 'password'} placeholder="নতুন পাসওয়ার্ড" value={newPassword}
                      onChange={e => { setNewPassword(e.target.value); setResetError(''); }} className="h-11 pr-9" />
                    <button type="button" onClick={() => setResetShowPwd1(p => !p)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{resetShowPwd1 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">পাসওয়ার্ড নিশ্চিত করুন</label>
                  <div className="relative">
                    <Input type={resetShowPwd2 ? 'text' : 'password'} placeholder="আবার পাসওয়ার্ড দিন" value={confirmPassword}
                      onChange={e => { setConfirmPassword(e.target.value); setResetError(''); }}
                      onKeyDown={e => e.key === 'Enter' && handleResetPassword()}
                      className="h-11 pr-9" />
                    <button type="button" onClick={() => setResetShowPwd2(p => !p)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{resetShowPwd2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                  </div>
                </div>
                {resetError && <p className="text-sm text-red-600 font-medium">{resetError}</p>}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {!showForgot ? (
            <>
              <Button variant="outline" onClick={onClose}>বাতিল</Button>
              <Button onClick={handleSubmit} disabled={loading || !password} className="bg-emerald-600 hover:bg-emerald-700">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4 mr-1" />}
                প্রবেশ
              </Button>
            </>
          ) : resetStep === 'email' ? (
            <Button onClick={handleSendOtp} disabled={resetLoading || !resetEmail} className="bg-amber-600 hover:bg-amber-700">
              {resetLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
              কোড পাঠান
            </Button>
          ) : (
            <Button onClick={handleResetPassword} disabled={resetLoading || !otpCode || !newPassword || !confirmPassword} className="bg-emerald-600 hover:bg-emerald-700">
              {resetLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
              পাসওয়ার্ড পরিবর্তন করুন
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== ERROR BOUNDARY ====================
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: ReactNode }) { super(props); this.state = { hasError: false, error: '' }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, error: error.message || String(error) }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="text-center py-16">
          <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-red-500" />
          <p className="text-red-600 font-medium">এরর হয়েছে</p>
          <p className="text-xs text-slate-500 mt-1">{this.state.error}</p>
          <Button variant="outline" className="mt-4" onClick={() => this.setState({ hasError: false, error: '' })}>আবার চেষ্টা করুন</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ==================== MAIN PAGE (Client Component) ====================

export default function HomeClient() {
  const [tab, setTab] = useState('search');
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mealSummaryRefreshKey, setMealSummaryRefreshKey] = useState(0);

  // Admin auto-logout: ১০ মিনিট inactivity
  const adminInactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ADMIN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

  const resetAdminInactivityTimer = useCallback(() => {
    if (adminInactivityTimer.current) clearTimeout(adminInactivityTimer.current);
    adminInactivityTimer.current = setTimeout(() => {
      if (sessionStorage.getItem('adminAuth') === 'true') {
        sessionStorage.removeItem('adminAuth');
        sessionStorage.removeItem('adminPwd');
        setIsAdminLoggedIn(false);
        setTab('search');
      }
    }, ADMIN_TIMEOUT_MS);
  }, []);

  // Hydration-safe: sessionStorage শুধু client-side mount এর পর পড়ুন
  useEffect(() => {
    setMounted(true);
    if (sessionStorage.getItem('adminAuth') === 'true') {
      setIsAdminLoggedIn(true);
      setTab('admin');
    }
    const savedMealUser = localStorage.getItem('mealUser');
    if (savedMealUser) {
      try { setMoLoggedInUser(JSON.parse(savedMealUser)); } catch {}
    }
  }, []);

  // Admin inactivity tracking — mouse, keyboard, scroll, touch
  useEffect(() => {
    if (!isAdminLoggedIn) {
      if (adminInactivityTimer.current) clearTimeout(adminInactivityTimer.current);
      return;
    }
    resetAdminInactivityTimer();
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'] as const;
    const handler = () => resetAdminInactivityTimer();
    events.forEach(e => window.addEventListener(e, handler, { passive: true }));
    return () => {
      events.forEach(e => window.removeEventListener(e, handler));
      if (adminInactivityTimer.current) clearTimeout(adminInactivityTimer.current);
    };
  }, [isAdminLoggedIn, resetAdminInactivityTimer]);

  // ===== মিল অর্ডার Dialog state =====
  const [mealOrderOpen, setMealOrderOpen] = useState(false);
  const [moUserQuery, setMoUserQuery] = useState('');
  const [moSuggestions, setMoSuggestions] = useState<Array<{officeId: string; name: string; mobile: string; designation: string}>>([]);
  const [moSuggestOpen, setMoSuggestOpen] = useState(false);
  const [moSelectedUser, setMoSelectedUser] = useState<{officeId: string; name: string; mobile: string; designation: string} | null>(null);
  const [moBreakfast, setMoBreakfast] = useState(0);
  const [moLunch, setMoLunch] = useState(0);
  const [moMorningSpecial, setMoMorningSpecial] = useState(0);
  const [moLunchSpecial, setMoLunchSpecial] = useState(0);
  const [moSaving, setMoSaving] = useState(false);
  const [moOrders, setMoOrders] = useState<any[]>([]);
  const [moOrdersLoading, setMoOrdersLoading] = useState(false);
  const [moOrdersLoaded, setMoOrdersLoaded] = useState(false);
  const [moSummaryMonth, setMoSummaryMonth] = useState(currentMonth);
  const [moSummaryYear, setMoSummaryYear] = useState(currentYear);
  const [moSummaryLoading, setMoSummaryLoading] = useState(false);
  const [moSummaryData, setMoSummaryData] = useState<any>(null);
  const [moSummaryDetails, setMoSummaryDetails] = useState<any[]>([]);
  const moSuggestTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // স্পেশাল মিল স্ট্যাটাস (এডমিন এক্টিভ করেছে কিনা)
  const [moSpecialStatus, setMoSpecialStatus] = useState<{ morningSpecial: boolean; lunchSpecial: boolean }>({ morningSpecial: false, lunchSpecial: false });
  const [moSpecialLoading, setMoSpecialLoading] = useState(false);
  // সময় উইন্ডো (কোন মিল এখন অর্ডার করা যাবে)
  const [moTimeWindow, setMoTimeWindow] = useState<{ breakfastOpen: boolean; lunchOpen: boolean }>({ breakfastOpen: true, lunchOpen: true });

  // ===== মিল অর্ডার লগইন/সাইনআপ =====
  const [moAuthMode, setMoAuthMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [moLoggedInUser, setMoLoggedInUser] = useState<{ id: string; officeId: string; name: string; mobile: string; designation: string; officeEmail: string } | null>(null);
  const [moSigninLoading, setMoSigninLoading] = useState(false);
  const [moSignupLoading, setMoSignupLoading] = useState(false);
  const [moForgotLoading, setMoForgotLoading] = useState(false);
  // Signin form
  const [moSigninUsername, setMoSigninUsername] = useState('');
  const [moSigninPassword, setMoSigninPassword] = useState('');
  const [moSigninShowPwd, setMoSigninShowPwd] = useState(false);
  // সাইন ইন username চেক — টাইপ করলে real-time যাচাই
  const [moSigninUserCheck, setMoSigninUserCheck] = useState<'idle' | 'found' | 'notfound'>('idle');
  const moSigninCheckTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Signup form
  const [moSignupForm, setMoSignupForm] = useState<Record<string, string>>({});
  const [moSignupShowPwd, setMoSignupShowPwd] = useState(false);
  const [moSignupOfficeIdCheck, setMoSignupOfficeIdCheck] = useState<'idle' | 'exists' | 'available'>('idle');
  const [moSignupOfficeIdSource, setMoSignupOfficeIdSource] = useState<'mealuser' | 'mealentry' | ''>('');
  const [moSignupSuggestOpen, setMoSignupSuggestOpen] = useState(false);
  const [moSignupSuggestions, setMoSignupSuggestions] = useState<Array<{officeId: string; name: string; mobile: string; designation: string}>>([]);
  const moSignupSuggestTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Forgot password form — 2-step OTP flow
  const [moForgotEmail, setMoForgotEmail] = useState('');
  const [moForgotOtp, setMoForgotOtp] = useState('');
  const [moForgotNewPassword, setMoForgotNewPassword] = useState('');
  const [moForgotShowPwd, setMoForgotShowPwd] = useState(false);
  const [moForgotStep, setMoForgotStep] = useState<1 | 2>(1); // 1 = enter email, 2 = enter OTP + new password
  const [moForgotOtpSent, setMoForgotOtpSent] = useState(false);

  // ===== মিল অর্ডার তারিখ (ডিফল্ট: আজকের তারিখ) =====
  const getBdToday = () => {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const bdMs = utcMs + 6 * 60 * 60000;
    const bd = new Date(bdMs);
    const dd = String(bd.getDate()).padStart(2, '0');
    const mm = String(bd.getMonth() + 1).padStart(2, '0');
    const yyyy = bd.getFullYear();
    return { iso: `${yyyy}-${mm}-${dd}`, display: `${dd}-${mm}-${yyyy}`, monthIdx: bd.getMonth(), year: String(yyyy) };
  };
  const todayBd = getBdToday();
  const [moOrderDate, setMoOrderDate] = useState(todayBd.iso);

  // moOrderDate থেকে display/metadata বের করুন
  const moOrderDateParsed = (() => {
    const parts = moOrderDate.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return {
      iso: moOrderDate,
      display: `${parts[2]}-${parts[1]}-${parts[0]}`,
      monthIdx: d.getMonth(),
      year: parts[0],
    };
  })();

  // ===== কাউন্টডাউন টাইমার =====
  const [moCountdown, setMoCountdown] = useState<{ breakfast: string; lunch: string; breakfastExpired: boolean; lunchExpired: boolean }>({
    breakfast: '', lunch: '', breakfastExpired: false, lunchExpired: false
  });
  const moCountdownRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // ===== ৫ মিনিট অকার্যকর থাকলে অটো লগআউট =====
  const AUTO_LOGOUT_MS = 5 * 60 * 1000; // ৫ মিনিট
  useEffect(() => {
    if (!isAdminLoggedIn) return;

    let logoutTimer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(logoutTimer);
      logoutTimer = setTimeout(() => {
        sessionStorage.removeItem('adminAuth');
        sessionStorage.removeItem('adminPwd');
        setIsAdminLoggedIn(false);
        setTab('search');
      }, AUTO_LOGOUT_MS);
    };

    // ইউজার অ্যাক্টিভিটি ট্র্যাক করুন
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach(evt => window.addEventListener(evt, resetTimer, { passive: true }));
    resetTimer(); // প্রথমবার টাইমার শুরু

    return () => {
      clearTimeout(logoutTimer);
      events.forEach(evt => window.removeEventListener(evt, resetTimer));
    };
  }, [isAdminLoggedIn]);

  const handleAdminTabClick = () => {
    if (isAdminLoggedIn) {
      setTab('admin');
    } else {
      setShowPasswordDialog(true);
    }
  };
  const handlePasswordSuccess = () => {
    setIsAdminLoggedIn(true);
    setShowPasswordDialog(false);
    setTab('admin');
  };
  const handleLogout = () => {
    setIsAdminLoggedIn(false);
    setTab('search');
  };

  // ===== মিল অর্ডার handlers =====
  const { toast: moToast } = useToast();

  // (tomorrow সরানো হয়েছে — এখন moOrderDate স্টেট ব্যবহার হয়)

  const handleMoSuggest = (value: string) => {
    setMoUserQuery(value);
    setMoSelectedUser(null);
    clearTimeout(moSuggestTimer.current);
    if (!value || value.length < 2) { setMoSuggestions([]); setMoSuggestOpen(false); return; }
    moSuggestTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/meal-order?action=suggest&query=${encodeURIComponent(value)}`);
        const data = await res.json();
        if (data.success && data.users) {
          setMoSuggestions(data.users);
          setMoSuggestOpen(data.users.length > 0);
        } else {
          setMoSuggestions([]);
          setMoSuggestOpen(false);
        }
      } catch { setMoSuggestions([]); setMoSuggestOpen(false); }
    }, 300);
  };

  const handleMoSelectUser = (user: any) => {
    setMoSelectedUser(user);
    setMoSuggestions([]);
    setMoSuggestOpen(false);
    setMoUserQuery(user.name || user.officeId);
  };

  const fetchMoOrders = async () => {
    setMoOrdersLoading(true);
    try {
      const oidParam = moLoggedInUser?.officeId ? `&officeId=${encodeURIComponent(moLoggedInUser.officeId)}` : '';
      const res = await fetch(`/api/meal-order?action=list&orderDate=${moOrderDate}${oidParam}`);
      const data = await res.json();
      if (data.success) {
        const allOrders = data.orders || [];
        // শুধু নিজের অর্ডার দেখানো (লগইন করা ইউজারের officeId অনুযায়ী)
        if (moLoggedInUser?.officeId) {
          const myOrders = allOrders.filter((o: any) => o.officeId === moLoggedInUser.officeId);
          setMoOrders(myOrders);
        } else {
          setMoOrders(allOrders);
        }
        setMoOrdersLoaded(true);
      }
    } catch { /* silent */ }
    finally { setMoOrdersLoading(false); }
  };

  // ===== সামারি ফেচ (হ্যান্ডলারদের আগে ডিফাইন) =====
  const fetchMoSummary = useCallback(async (month: string, year: string, showToast = false) => {
    if (!month || !year) return;
    setMoSummaryLoading(true);
    try {
      const oidParam = moLoggedInUser?.officeId ? `&officeId=${encodeURIComponent(moLoggedInUser.officeId)}` : '';
      const res = await fetch(`/api/meal-order?action=summary&month=${encodeURIComponent(month)}&year=${year}${oidParam}`);
      const data = await res.json();
      if (data.success) {
        setMoSummaryData(data.summary);
        setMoSummaryDetails(data.details || []);
      } else if (showToast) {
        moToast({ title: 'ত্রুটি', description: data.error, variant: 'destructive' });
      }
    } catch {
      if (showToast) moToast({ title: 'ত্রুটি', variant: 'destructive' });
    }
    finally { setMoSummaryLoading(false); }
  }, [moToast, moLoggedInUser?.officeId]);

  const handleMoSave = async () => {
    if (!moSelectedUser && !moLoggedInUser) {
      moToast({ title: 'তথ্য সম্পূর্ণ দিন', description: 'অর্ডারকারী সিলেক্ট করুন', variant: 'destructive' });
      return;
    }
    if (!moBreakfast && !moLunch && !moMorningSpecial && !moLunchSpecial) {
      moToast({ title: 'তথ্য সম্পূর্ণ দিন', description: 'কমপক্ষে একটি মিল সিলেক্ট করুন', variant: 'destructive' });
      return;
    }
    setMoSaving(true);
    try {
      const res = await fetch('/api/meal-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId: (moSelectedUser || moLoggedInUser)!.officeId,
          name: (moSelectedUser || moLoggedInUser)!.name,
          mobile: (moSelectedUser || moLoggedInUser)!.mobile,
          designation: (moSelectedUser || moLoggedInUser)!.designation,
          orderDate: moOrderDate,
          month: MONTHS_NO_ALL[moOrderDateParsed.monthIdx],
          year: moOrderDateParsed.year,
          breakfast: moBreakfast,
          lunch: moLunch,
          morningSpecial: moMorningSpecial,
          lunchSpecial: moLunchSpecial,
        })
      });
      const data = await res.json();
      if (data.success) {
        try { moToast({ title: 'সেভ হয়েছে', description: data.message, variant: 'success' }); } catch {}
        setMoSelectedUser(null);
        setMoUserQuery('');
        setMoBreakfast(0);
        setMoLunch(0);
        setMoMorningSpecial(0);
        setMoLunchSpecial(0);
        fetchMoOrders();
        fetchMoSummary(moSummaryMonth, moSummaryYear);
        dispatchMealDataChanged();
      } else {
        moToast({ title: 'এরর', description: data.error, variant: 'destructive' });
      }
    } catch (err: any) {
      console.error('handleMoSave error:', err);
      try { moToast({ title: 'এরর', description: 'অর্ডার সেভ ব্যর্থ হয়েছে', variant: 'destructive' }); } catch {}
    }
    finally { setMoSaving(false); }
  };

  const handleMoDeleteOrder = async (officeId: string) => {
    try {
      const res = await fetch(`/api/meal-order?officeId=${encodeURIComponent(officeId)}&orderDate=${moOrderDate}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        try { moToast({ title: 'ডিলিট হয়েছে', description: data.message, variant: 'success' }); } catch {}
        fetchMoOrders();
        fetchMoSummary(moSummaryMonth, moSummaryYear);
        dispatchMealDataChanged();
      } else {
        moToast({ title: 'এরর', description: data.error, variant: 'destructive' });
      }
    } catch (err: any) {
      console.error('handleMoDeleteOrder error:', err);
      try { moToast({ title: 'ডিলিট হয়েছে', description: 'মিল অর্ডার ডিলিট হয়েছে', variant: 'success' }); } catch {}
    }
  };

  const handleMoSummarySearch = async () => {
    if (!moSummaryMonth || !moSummaryYear) {
      moToast({ title: 'তথ্য দিন', description: 'মাস ও বছর সিলেক্ট করুন', variant: 'destructive' });
      return;
    }
    await fetchMoSummary(moSummaryMonth, moSummaryYear, true);
  };

  // ডিফল্ট মাস/বছরে অটো লোড এবং মাস/বছর পরিবর্তনে অটো আপডেট
  useEffect(() => {
    if (moSummaryMonth && moSummaryYear) {
      fetchMoSummary(moSummaryMonth, moSummaryYear, false);
    }
  }, [moSummaryMonth, moSummaryYear, fetchMoSummary]);

  // Admin থেকে মিল অর্ডার পরিবর্তন হলে সামারি অটো রিফ্রেশ
  useEffect(() => {
    if (mealSummaryRefreshKey > 0) fetchMoSummary(moSummaryMonth, moSummaryYear);
  }, [mealSummaryRefreshKey, fetchMoSummary]);

  // Global auto-refresh: যেকোনো ডাটা পরিবর্তন হলে ইউজারের মিল সামারি রিফ্রেশ
  useEffect(() => {
    const handler = () => {
      fetchMoSummary(moSummaryMonth, moSummaryYear);
      if (mealOrderOpen) fetchMoOrders();
    };
    window.addEventListener('meal-data-changed', handler);
    return () => window.removeEventListener('meal-data-changed', handler);
  }, [moSummaryMonth, moSummaryYear, mealOrderOpen, fetchMoSummary]);

  // Dialog খুললে orders, special status ও time window লোড করুন
  // moLoggedInUser ও ডিপেন্ডেন্সি — লগইন সেশন লোড হলে নিজের অর্ডার রিফেচ
  useEffect(() => {
    if (mealOrderOpen) {
      fetchMoOrders();
      // সিলেক্ট করা তারিখের স্পেশাল মিল স্ট্যাটাস চেক করুন
      setMoSpecialLoading(true);
      fetch(`/api/special-meal?action=status&orderDate=${moOrderDate}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setMoSpecialStatus({ morningSpecial: !!data.morningSpecial, lunchSpecial: !!data.lunchSpecial });
          }
        })
        .catch(() => {})
        .finally(() => setMoSpecialLoading(false));
      // সময় উইন্ডো চেক করুন
      fetch(`/api/special-meal?action=time_window&orderDate=${moOrderDate}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setMoTimeWindow({ breakfastOpen: data.breakfastWindowOpen, lunchOpen: data.lunchWindowOpen });
          }
        })
        .catch(() => {});
    }
  }, [mealOrderOpen, moOrderDate, moLoggedInUser]);

  // তারিখ পরিবর্তন হলে অর্ডার রিসেট করুন
  const handleMoDateChange = (newDate: string) => {
    setMoOrderDate(newDate);
    setMoOrdersLoaded(false);
    setMoOrders([]);
  };

  // ===== মিল অর্ডার লগইন/সাইনআপ Handlers =====
  // সাইন ইন username debounced চেক — MealUser-এ আছে কিনা
  const handleMoSigninUsernameChange = (value: string) => {
    setMoSigninUsername(value);
    setMoSigninUserCheck('idle');
    clearTimeout(moSigninCheckTimer.current);
    if (!value || value.length < 2) return;
    moSigninCheckTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check_signin_user', username: bnToEn(value.trim()) })
        });
        const data = await res.json();
        if (data.success) {
          setMoSigninUserCheck(data.found ? 'found' : 'notfound');
        }
      } catch { /* silent */ }
    }, 400);
  };

  const handleMoSignin = async () => {
    if (!moSigninUsername.trim() || !moSigninPassword) {
      moToast({ title: 'তথ্য দিন', description: 'অফিস আইডি/মোবাইল ও পাসওয়ার্ড দিন', variant: 'destructive' });
      return;
    }
    setMoSigninLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signin', username: moSigninUsername, password: moSigninPassword })
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('mealUser', JSON.stringify(data.user));
        setMoLoggedInUser(data.user);
        moToast({ title: 'স্বাগতম', description: `${data.user.name}, আপনি লগ ইন হয়েছেন`, variant: 'success' });
        // ইউজারের তথ্য দিয়ে অর্ডার ফর্ম ফিল করুন
        setMoSelectedUser({ officeId: data.user.officeId, name: data.user.name, mobile: data.user.mobile, designation: data.user.designation });
        setMoUserQuery(data.user.name);
      } else {
        moToast({ title: 'এরর', description: data.error, variant: 'destructive' });
      }
    } catch { moToast({ title: 'এরর', variant: 'destructive' }); }
    finally { setMoSigninLoading(false); }
  };

  const handleMoSignup = async () => {
    const f = moSignupForm;
    if (!f.officeEmail || !f.name || !f.designation || !f.mobile || !f.officeId || !f.password) {
      moToast({ title: 'তথ্য সম্পূর্ণ দিন', description: 'সব ঘর পূরণ করুন', variant: 'destructive' });
      return;
    }
    if (f.password.length < 4) {
      moToast({ title: 'তথ্য দিন', description: 'পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে', variant: 'destructive' });
      return;
    }
    setMoSignupLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'signup',
          officeEmail: f.officeEmail || '',
          officeId: f.officeId,
          name: f.name,
          designation: f.designation || '',
          mobile: f.mobile,
          password: f.password,
        })
      });
      const data = await res.json();
      if (data.success) {
        moToast({ title: 'সাইন আপ সফল', description: data.message, variant: 'success' });
        // অটো লগইন করুন
        setMoAuthMode('login');
        setMoSigninUsername(data.user.officeId);
        setMoSigninPassword(f.password);
        setMoSignupForm({});
        setMoSignupOfficeIdCheck('idle');
      } else {
        moToast({ title: 'এরর', description: data.error, variant: 'destructive' });
      }
    } catch { moToast({ title: 'এরর', variant: 'destructive' }); }
    finally { setMoSignupLoading(false); }
  };

  // Forgot password Step 1: Send OTP to email
  const handleMoForgotStep1 = async () => {
    if (!moForgotEmail.trim()) {
      moToast({ title: 'তথ্য দিন', description: 'রেজিস্টার্ড ইমেইল দিন', variant: 'destructive' });
      return;
    }
    setMoForgotLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'forgot_step1', email: moForgotEmail })
      });
      const data = await res.json();
      if (data.success) {
        // টেস্ট মোডে OTP অটো-ফিল করুন ও নোটিফিকেশন দেখান
        if (data.testMode && data.testOtp) {
          setMoForgotOtp(data.testOtp);
          moToast({ title: 'OTP পাঠানো হয়েছে (টেস্ট মোড)', description: `ইমেইল সার্ভিস কনফিগার নেই। টেস্ট OTP: ${data.testOtp}`, variant: 'success' });
        } else {
          moToast({ title: 'OTP পাঠানো হয়েছে', description: 'ইমেইলে একটি OTP কোড পাঠানো হয়েছে', variant: 'success' });
        }
        setMoForgotStep(2);
        setMoForgotOtpSent(true);
      } else {
        moToast({ title: 'এরর', description: data.error, variant: 'destructive' });
      }
    } catch { moToast({ title: 'এরর', variant: 'destructive' }); }
    finally { setMoForgotLoading(false); }
  };

  // Forgot password Step 2: Verify OTP + set new password
  const handleMoForgotStep2 = async () => {
    if (!moForgotOtp.trim() || !moForgotNewPassword || moForgotNewPassword.length < 4) {
      moToast({ title: 'তথ্য দিন', description: 'OTP কোড ও নতুন পাসওয়ার্ড (কমপক্ষে ৪ অক্ষর) দিন', variant: 'destructive' });
      return;
    }
    setMoForgotLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'forgot_step2', email: moForgotEmail, otp: moForgotOtp, newPassword: moForgotNewPassword })
      });
      const data = await res.json();
      if (data.success) {
        moToast({ title: 'সফল', description: data.message, variant: 'success' });
        setMoAuthMode('login');
        setMoForgotEmail('');
        setMoForgotOtp('');
        setMoForgotNewPassword('');
        setMoForgotStep(1);
        setMoForgotOtpSent(false);
      } else {
        moToast({ title: 'এরর', description: data.error, variant: 'destructive' });
      }
    } catch { moToast({ title: 'এরর', variant: 'destructive' }); }
    finally { setMoForgotLoading(false); }
  };

  const handleMoForgot = async () => {
    // Redirect to appropriate step
    if (moForgotStep === 1) {
      await handleMoForgotStep1();
    } else {
      await handleMoForgotStep2();
    }
  };

  const handleMoLogout = () => {
    localStorage.removeItem('mealUser');
    setMoLoggedInUser(null);
    setMoSelectedUser(null);
    setMoUserQuery('');
    setMoBreakfast(0);
    setMoLunch(0);
    setMoMorningSpecial(0);
    setMoLunchSpecial(0);
  };

  // সাইনআপ ফর্মে অফিস আইডি চেক
  const checkMoSignupOfficeId = async (oid: string) => {
    if (!oid || oid.length < 1) { setMoSignupOfficeIdCheck('idle'); setMoSignupOfficeIdSource(''); return; }
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_officeid', officeId: oid })
      });
      const data = await res.json();
      if (data.success) {
        if (data.exists && data.userData) {
          setMoSignupOfficeIdCheck('exists');
          setMoSignupOfficeIdSource(data.source || 'mealentry');
          // আগে থেকে থাকা ডাটা দিয়ে সব ফিল্ড অটো পূরণ করুন
          setMoSignupForm(prev => ({
            ...prev,
            officeId: data.userData.officeId || prev.officeId,
            name: data.userData.name || prev.name,
            designation: data.userData.designation || prev.designation,
            mobile: formatMobile(data.userData.mobile || prev.mobile),
            officeEmail: data.userData.officeEmail || prev.officeEmail,
          }));
          // সাজেশন লিস্ট বন্ধ করুন
          setMoSignupSuggestions([]);
          setMoSignupSuggestOpen(false);
        } else {
          setMoSignupOfficeIdCheck('available');
          setMoSignupOfficeIdSource('');
        }
      }
    } catch { /* silent */ }
  };

  // সাইনআপ সাজেশন
  const handleMoSignupSuggest = (value: string, field: string) => {
    setMoSignupForm(prev => ({ ...prev, [field]: value }));
    if (field === 'officeId' && value.length >= 1) {
      checkMoSignupOfficeId(bnToEn(value));
    }
    if (field === 'name' || field === 'mobile' || field === 'designation') {
      clearTimeout(moSignupSuggestTimer.current);
      if (!value || value.length < 2) { setMoSignupSuggestions([]); setMoSignupSuggestOpen(false); return; }
      moSignupSuggestTimer.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/auth?action=suggest&query=${encodeURIComponent(bnToEn(value))}`);
          const data = await res.json();
          if (data.success && data.users) {
            setMoSignupSuggestions(data.users);
            setMoSignupSuggestOpen(data.users.length > 0);
          } else {
            setMoSignupSuggestions([]);
            setMoSignupSuggestOpen(false);
          }
        } catch { setMoSignupSuggestions([]); setMoSignupSuggestOpen(false); }
      }, 300);
    }
  };

  const handleMoSignupSelectSuggestion = (user: any) => {
    setMoSignupForm(prev => ({
      ...prev,
      officeId: user.officeId || '',
      name: user.name || '',
      mobile: formatMobile(user.mobile || ''),
      designation: user.designation || '',
    }));
    setMoSignupSuggestions([]);
    setMoSignupSuggestOpen(false);
    if (user.officeId) checkMoSignupOfficeId(user.officeId);
  };

  // ===== কাউন্টডাউন টাইমার Effect =====
  useEffect(() => {
    if (!mealOrderOpen) {
      clearInterval(moCountdownRef.current);
      return;
    }

    const updateCountdown = () => {
      const now = new Date();
      const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
      const bdMs = utcMs + 6 * 60 * 60000;
      const bdNow = new Date(bdMs);

      // সিলেক্ট করা তারিখের ডেডলাইন তৈরি করুন
      const dateParts = moOrderDate.split('-');
      const selYear = parseInt(dateParts[0]);
      const selMonth = parseInt(dateParts[1]) - 1;
      const selDay = parseInt(dateParts[2]);

      // সকাল নাস্তা ডেডলাইন: সিলেক্ট করা তারিখের সকাল ৮:০০ BD time
      const breakfastDeadline = new Date(bdMs);
      breakfastDeadline.setFullYear(selYear, selMonth, selDay);
      breakfastDeadline.setHours(8, 0, 0, 0);

      // দুপুর মিল ডেডলাইন: সিলেক্ট করা তারিখের সকাল ১০:০০ BD time
      const lunchDeadline = new Date(bdMs);
      lunchDeadline.setFullYear(selYear, selMonth, selDay);
      lunchDeadline.setHours(10, 0, 0, 0);

      const bMs = breakfastDeadline.getTime() - bdNow.getTime();
      const lMs = lunchDeadline.getTime() - bdNow.getTime();

      const fmt = (ms: number) => {
        if (ms <= 0) return '00:00:00';
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      };

      setMoCountdown({
        breakfast: fmt(bMs),
        lunch: fmt(lMs),
        breakfastExpired: bMs <= 0,
        lunchExpired: lMs <= 0,
      });
    };

    updateCountdown();
    moCountdownRef.current = setInterval(updateCountdown, 1000);

    return () => clearInterval(moCountdownRef.current);
  }, [mealOrderOpen, moOrderDate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
      {/* Header */}
      <div className="bg-emerald-600 text-white py-3 shadow-lg">
        <div className="max-w-4xl mx-auto px-3 sm:px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <UtensilsCrossed className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-sm sm:text-lg md:text-xl font-bold truncate">অফিস মিল ম্যানেজমেন্ট সিস্টেম</h1>
                <p className="text-emerald-100 text-[9px] md:text-xs truncate hidden sm:block">কর্মকর্তা/কর্মচারীদের মিলের হিসাব ব্যবস্থাপনা</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-2">
              {isAdminLoggedIn && (
                <button onClick={() => {
                  sessionStorage.removeItem('adminAuth');
                  sessionStorage.removeItem('adminToken');
                  sessionStorage.removeItem('adminPwd');
                  handleLogout();
                }} className="flex items-center gap-1 text-[10px] px-1.5 py-1 sm:text-xs sm:px-3 sm:py-1.5 rounded bg-red-500 hover:bg-red-600 text-white whitespace-nowrap transition-all">
                  <LogOut className="h-3 w-3 sm:h-4 sm:w-4" /> লগআউট
                </button>
              )}
              <button
                onClick={handleAdminTabClick}
                className={tab === 'admin' ? 'flex items-center gap-1 text-[10px] px-1.5 py-1 sm:text-xs sm:px-3 sm:py-1.5 rounded bg-white text-emerald-700 hover:bg-emerald-50 font-semibold whitespace-nowrap transition-all' : 'flex items-center gap-1 text-[10px] px-1.5 py-1 sm:text-xs sm:px-3 sm:py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-white border border-emerald-400 whitespace-nowrap transition-all'}>
                {isAdminLoggedIn ? <Unlock className="h-3 w-3 sm:h-4 sm:w-4" /> : <Lock className="h-3 w-3 sm:h-4 sm:w-4" />}
                Admin
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* Tabs */}
      <div className="max-w-4xl mx-auto w-full px-4 mt-4">
        <div className="flex gap-2">
          {!isAdminLoggedIn && (
            <Button variant={tab === 'search' ? 'default' : 'outline'}
              onClick={() => setTab('search')}
              className={tab === 'search' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}>
              <Search className="h-4 w-4 mr-1" /> সার্চ
            </Button>
          )}
          {!isAdminLoggedIn && (
            <Button
              variant="outline"
              onClick={() => setMealOrderOpen(true)}
              className="bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 gap-1">
              <ShoppingCart className="h-4 w-4" /> মিল অর্ডার
            </Button>
          )}
        </div>
      </div>
      {/* Content */}
      <main className="max-w-4xl mx-auto w-full px-4 py-4">
        {tab === 'search' ? <SearchSection /> : <ErrorBoundary><AdminPanel onLogout={handleLogout} onMealOrderChange={() => { setMealSummaryRefreshKey(k => k + 1); dispatchMealDataChanged(); }} /></ErrorBoundary>}
      </main>
      {/* Password Dialog */}
      {showPasswordDialog && (
        <PasswordDialog
          onSuccess={handlePasswordSuccess}
          onClose={() => setShowPasswordDialog(false)}
        />
      )}
      {/* Meal Order Dialog */}
      <Dialog open={mealOrderOpen} onOpenChange={(open) => { if (!open) { clearInterval(moCountdownRef.current); } setMealOrderOpen(open); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700">
              <ShoppingCart className="h-5 w-5" /> মিল অর্ডার
              {moLoggedInUser && (
                <button onClick={handleMoLogout} className="ml-auto text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                  <LogOut className="h-3.5 w-3.5" /> লগ আউট ({moLoggedInUser.name})
                </button>
              )}
            </DialogTitle>
          </DialogHeader>

          {!moLoggedInUser ? (
            /* ===== লগইন / সাইনআপ / ফরগট পাসওয়ার্ড ===== */
            <div className="space-y-4">
              {moAuthMode === 'login' && (
                <>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium text-slate-700">মিল অর্ডার করতে লগ ইন করুন</p>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">অফিস আইডি বা মোবাইল নম্বর</label>
                      <div className="relative">
                        <Input
                          placeholder="অফিস আইডি / মোবাইল"
                          value={moSigninUsername}
                          onChange={(e) => handleMoSigninUsernameChange(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleMoSignin()}
                          className={`text-sm pr-9 ${moSigninUserCheck === 'found' ? 'border-emerald-400 bg-emerald-50' : moSigninUserCheck === 'notfound' ? 'border-red-300 bg-red-50' : ''}`}
                        />
                        {moSigninUserCheck === 'found' && (
                          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-500">
                            <CheckCircle className="h-4.5 w-4.5" />
                          </div>
                        )}
                        {moSigninUserCheck === 'notfound' && (
                          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-red-400">
                            <X className="h-4.5 w-4.5" />
                          </div>
                        )}
                      </div>
                      {moSigninUserCheck === 'found' && <p className="text-[11px] text-emerald-600 mt-0.5">✅ একাউন্ট পাওয়া গেছে</p>}
                      {moSigninUserCheck === 'notfound' && <p className="text-[11px] text-red-500 mt-0.5">এই আইডি/মোবাইলে কোনো একাউন্ট নেই</p>}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">পাসওয়ার্ড</label>
                      <div className="relative">
                        <Input
                          type={moSigninShowPwd ? 'text' : 'password'}
                          placeholder="পাসওয়ার্ড"
                          value={moSigninPassword}
                          onChange={(e) => setMoSigninPassword(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleMoSignin()}
                          className="text-sm pr-9"
                        />
                        <button type="button" onClick={() => setMoSigninShowPwd(p => !p)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{moSigninShowPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                      </div>
                    </div>
                    <Button onClick={handleMoSignin} disabled={moSigninLoading} className="w-full bg-emerald-600 hover:bg-emerald-700">
                      {moSigninLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                      সাইন ইন
                    </Button>
                  </div>
                  <div className="flex items-center justify-center gap-4 text-sm">
                    <button onClick={() => { setMoAuthMode('signup'); setMoSignupForm({}); setMoSignupOfficeIdCheck('idle'); }} className="text-emerald-600 hover:underline font-medium">
                      সাইন আপ
                    </button>
                    <span className="text-slate-300">|</span>
                    <button onClick={() => { setMoAuthMode('forgot'); setMoForgotStep(1); setMoForgotEmail(''); setMoForgotOtp(''); setMoForgotNewPassword(''); setMoForgotOtpSent(false); }} className="text-amber-600 hover:underline font-medium">
                      Forgot Password?
                    </button>
                  </div>
                </>
              )}

              {moAuthMode === 'signup' && (
                <>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium text-slate-700">নতুন একাউন্ট তৈরি করুন</p>
                    <p className="text-[11px] text-slate-500">নাম/মোবাইল লিখলে ডাটাবেজে থাকলে সাজেশন আসবে</p>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">অফিস ইমেইল <span className="text-red-500">*</span></label>
                      <Input
                        type="email"
                        placeholder="অফিস ইমেইল"
                        value={moSignupForm.officeEmail || ''}
                        onChange={(e) => setMoSignupForm(prev => ({ ...prev, officeEmail: e.target.value }))}
                        className="text-sm"
                      />
                    </div>
                    <div className="relative">
                      <label className="text-xs font-medium text-slate-600 mb-1 block">অফিস আইডি <span className="text-red-500">*</span> (সর্বোচ্চ ৬ সংখ্যা)</label>
                      <Input
                        placeholder="অফিস আইডি"
                        value={moSignupForm.officeId || ''}
                        onChange={(e) => handleMoSignupSuggest(e.target.value, 'officeId')}
                        className={`text-sm ${moSignupOfficeIdCheck === 'exists' && moSignupOfficeIdSource === 'mealuser' ? 'border-red-400 bg-red-50' : moSignupOfficeIdCheck === 'exists' && moSignupOfficeIdSource === 'mealentry' ? 'border-amber-400 bg-amber-50' : moSignupOfficeIdCheck === 'available' ? 'border-emerald-400 bg-emerald-50' : ''}`}
                      />
                      {moSignupOfficeIdCheck === 'exists' && moSignupOfficeIdSource === 'mealuser' && <p className="text-[11px] text-red-500 mt-0.5">⚠️ এই অফিস আইডি দিয়ে আগেই একাউন্ট আছে। <span className="underline cursor-pointer text-blue-600" onClick={() => setMoAuthMode('login')}>সাইন ইন</span> করুন।</p>}
                      {moSignupOfficeIdCheck === 'exists' && moSignupOfficeIdSource === 'mealentry' && <p className="text-[11px] text-amber-600 mt-0.5">✅ এই আইডি ডাটাবেজে আছে — তথ্য অটো পূরণ হয়েছে। নিচে পাসওয়ার্ড দিয়ে সাইন আপ করুন।</p>}
                      {moSignupOfficeIdCheck === 'available' && <p className="text-[11px] text-emerald-600 mt-0.5">✓ এই অফিস আইডি ব্যবহার করা যাবে</p>}
                    </div>
                    <div className="relative">
                      <label className="text-xs font-medium text-slate-600 mb-1 block">নাম <span className="text-red-500">*</span></label>
                      <Input
                        placeholder="নাম"
                        value={moSignupForm.name || ''}
                        onChange={(e) => handleMoSignupSuggest(e.target.value, 'name')}
                        className="text-sm"
                      />
                      {moSignupSuggestOpen && moSignupSuggestions.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                          {moSignupSuggestions.map((u, i) => (
                            <button key={i} className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 border-b border-slate-100 last:border-0 text-xs" onClick={() => handleMoSignupSelectSuggestion(u)}>
                              <span className="font-medium">{u.name}</span>
                              {u.designation && <span className="text-blue-600 ml-1">({u.designation})</span>}
                              <div className="text-slate-500">{u.officeId} • {u.mobile}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <label className="text-xs font-medium text-slate-600 mb-1 block">পদবী <span className="text-red-500">*</span></label>
                      <Input
                        value={moSignupForm.designation || ''}
                        onChange={(e) => handleMoSignupSuggest(e.target.value, 'designation')}
                        className="text-sm"
                      />
                      {moSignupSuggestOpen && moSignupSuggestions.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                          {moSignupSuggestions.map((u, i) => (
                            <button key={i} className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 border-b border-slate-100 last:border-0 text-xs" onClick={() => handleMoSignupSelectSuggestion(u)}>
                              <span className="font-medium">{u.name}</span>
                              {u.designation && <span className="text-blue-600 ml-1">({u.designation})</span>}
                              <div className="text-slate-500">{u.officeId} • {u.mobile}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <label className="text-xs font-medium text-slate-600 mb-1 block">মোবাইল নম্বর <span className="text-red-500">*</span></label>
                      <Input
                        placeholder="মোবাইল নম্বর"
                        value={moSignupForm.mobile || ''}
                        onChange={(e) => handleMoSignupSuggest(e.target.value, 'mobile')}
                        className="text-sm"
                      />
                      {moSignupSuggestOpen && moSignupSuggestions.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                          {moSignupSuggestions.map((u, i) => (
                            <button key={i} className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 border-b border-slate-100 last:border-0 text-xs" onClick={() => handleMoSignupSelectSuggestion(u)}>
                              <span className="font-medium">{u.name}</span>
                              {u.designation && <span className="text-blue-600 ml-1">({u.designation})</span>}
                              <div className="text-slate-500">{u.officeId} • {u.mobile}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">পাসওয়ার্ড <span className="text-red-500">*</span> (কমপক্ষে ৪ অক্ষর)</label>
                      <div className="relative">
                        <Input
                          type={moSignupShowPwd ? 'text' : 'password'}
                          placeholder="পাসওয়ার্ড"
                          value={moSignupForm.password || ''}
                          onChange={(e) => setMoSignupForm(prev => ({ ...prev, password: e.target.value }))}
                          className="text-sm pr-9"
                        />
                        <button type="button" onClick={() => setMoSignupShowPwd(p => !p)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{moSignupShowPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                      </div>
                    </div>
                    <Button onClick={handleMoSignup} disabled={moSignupLoading || (moSignupOfficeIdCheck === 'exists' && moSignupOfficeIdSource === 'mealuser')} className="w-full bg-emerald-600 hover:bg-emerald-700">
                      {moSignupLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                      সাইন আপ করুন
                    </Button>
                  </div>
                  <div className="flex items-center justify-center gap-4 text-sm">
                    <button onClick={() => setMoAuthMode('login')} className="text-emerald-600 hover:underline font-medium">
                      সাইন ইন
                    </button>
                    <span className="text-slate-300">|</span>
                    <button onClick={() => { setMoAuthMode('forgot'); setMoForgotStep(1); setMoForgotEmail(''); setMoForgotOtp(''); setMoForgotNewPassword(''); setMoForgotOtpSent(false); }} className="text-amber-600 hover:underline font-medium">
                      Forgot Password?
                    </button>
                  </div>
                </>
              )}

              {moAuthMode === 'forgot' && (
                <>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium text-slate-700">পাসওয়ার্ড পরিবর্তন করুন</p>
                    {moForgotStep === 1 && (
                      <p className="text-[11px] text-slate-500">আপনার রেজিস্টার্ড ইমেইল দিন, সেখানে একটি OTP কোড পাঠানো হবে</p>
                    )}
                    {moForgotStep === 2 && (
                      <p className="text-[11px] text-emerald-600 font-medium">✉️ OTP ইমেইলে পাঠানো হয়েছে — ৫ মিনিটের মধ্যে ব্যবহার করুন</p>
                    )}
                  </div>
                  <div className="space-y-3">
                    {/* Step 1: Enter Email */}
                    {moForgotStep === 1 && (
                      <>
                        <div>
                          <label className="text-xs font-medium text-slate-600 mb-1 block">রেজিস্টার্ড ইমেইল</label>
                          <Input
                            type="email"
                            placeholder="example@office.gov.bd"
                            value={moForgotEmail}
                            onChange={(e) => setMoForgotEmail(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleMoForgotStep1()}
                            className="text-sm"
                          />
                        </div>
                        <Button onClick={handleMoForgotStep1} disabled={moForgotLoading} className="w-full bg-amber-600 hover:bg-amber-700">
                          {moForgotLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                          OTP পাঠান
                        </Button>
                      </>
                    )}
                    {/* Step 2: Enter OTP + New Password */}
                    {moForgotStep === 2 && (
                      <>
                        <div>
                          <label className="text-xs font-medium text-slate-600 mb-1 block">ইমেইল</label>
                          <Input
                            type="email"
                            value={moForgotEmail}
                            readOnly
                            className="text-sm bg-slate-50"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-600 mb-1 block">OTP কোড <span className="text-red-500">*</span></label>
                          <Input
                            placeholder="৬ সংখ্যার OTP কোড"
                            value={moForgotOtp}
                            onChange={(e) => setMoForgotOtp(e.target.value)}
                            className="text-sm"
                            maxLength={6}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-600 mb-1 block">নতুন পাসওয়ার্ড <span className="text-red-500">*</span> (কমপক্ষে ৪ অক্ষর)</label>
                          <div className="relative">
                            <Input
                              type={moForgotShowPwd ? 'text' : 'password'}
                              placeholder="নতুন পাসওয়ার্ড"
                              value={moForgotNewPassword}
                              onChange={(e) => setMoForgotNewPassword(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleMoForgotStep2()}
                              className="text-sm pr-9"
                            />
                            <button type="button" onClick={() => setMoForgotShowPwd(p => !p)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{moForgotShowPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                          </div>
                        </div>
                        <Button onClick={handleMoForgotStep2} disabled={moForgotLoading} className="w-full bg-emerald-600 hover:bg-emerald-700">
                          {moForgotLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                          পাসওয়ার্ড পরিবর্তন করুন
                        </Button>
                        <button
                          onClick={() => { setMoForgotStep(1); setMoForgotOtp(''); setMoForgotNewPassword(''); setMoForgotOtpSent(false); }}
                          className="w-full text-xs text-amber-600 hover:underline text-center"
                        >
                          OTP আবার পাঠান
                        </button>
                      </>
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-4 text-sm">
                    <button onClick={() => { setMoAuthMode('login'); setMoForgotStep(1); setMoForgotEmail(''); setMoForgotOtp(''); setMoForgotNewPassword(''); setMoForgotOtpSent(false); }} className="text-emerald-600 hover:underline font-medium">
                      সাইন ইন
                    </button>
                    <span className="text-slate-300">|</span>
                    <button onClick={() => { setMoAuthMode('signup'); setMoSignupForm({}); setMoSignupOfficeIdCheck('idle'); }} className="text-emerald-600 hover:underline font-medium">
                      সাইন আপ
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            /* ===== লগইন হয়ে থাকলে অর্ডার সেকশন ===== */
            <Tabs defaultValue="order" className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-11 bg-slate-100 p-1 rounded-xl">
              <TabsTrigger value="order" className="rounded-lg text-sm font-semibold data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all">🍽️ অর্ডার দিন</TabsTrigger>
              <TabsTrigger value="summary" className="rounded-lg text-sm font-semibold data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all">📋 মিলের বিবরণ</TabsTrigger>
            </TabsList>

              {/* ===== Tab 1: অর্ডার দিন ===== */}
              <TabsContent value="order" className="space-y-4 mt-4">
                {/* Logged-in User Info */}
                <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  <span className="font-medium">{moLoggedInUser.name}</span>
                  <span className="text-slate-500">—</span>
                  <span className="text-blue-600">{moLoggedInUser.designation || 'N/A'}</span>
                  <span className="text-slate-400 ml-auto text-xs">{moLoggedInUser.officeId}</span>
                </div>
                {/* Date Field (Fixed) */}
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">অর্ডারের তারিখ</label>
                  <Input type="date" value={moOrderDate} onChange={e => handleMoDateChange(e.target.value)} className="text-sm" />
                </div>
                {/* Toggle Buttons with Countdown */}
                {(() => {
                  const curOrder = moLoggedInUser ? moOrders.find((o: any) => o.officeId === moLoggedInUser.officeId) : null;
                  const curB = curOrder ? Number(curOrder.breakfast || 0) : 0;
                  const curL = curOrder ? Number(curOrder.lunch || 0) : 0;
                  const curMS = curOrder ? Number(curOrder.morningSpecial || 0) : 0;
                  const curLS = curOrder ? Number(curOrder.lunchSpecial || 0) : 0;
                  const btns = [
                    {
                      label: 'সকাল নাস্তা',
                      state: moBreakfast,
                      setter: setMoBreakfast,
                      disabled: moSpecialStatus.morningSpecial || (!isAdminLoggedIn && moCountdown.breakfastExpired),
                      disabledReason: moSpecialStatus.morningSpecial ? 'সকাল স্পেশাল চালু আছে' : moCountdown.breakfastExpired ? 'সময় শেষ' : '',
                      countdown: moCountdown.breakfast,
                      countdownExpired: moCountdown.breakfastExpired,
                      currentCount: curB,
                    },
                    {
                      label: 'দুপুর মিল',
                      state: moLunch,
                      setter: setMoLunch,
                      disabled: moSpecialStatus.lunchSpecial || (!isAdminLoggedIn && moCountdown.lunchExpired),
                      disabledReason: moSpecialStatus.lunchSpecial ? 'দুপুর স্পেশাল চালু আছে' : moCountdown.lunchExpired ? 'সময় শেষ' : '',
                      countdown: moCountdown.lunch,
                      countdownExpired: moCountdown.lunchExpired,
                      currentCount: curL,
                    },
                    {
                      label: 'সকাল স্পেশাল',
                      state: moMorningSpecial,
                      setter: setMoMorningSpecial,
                      disabled: !moSpecialStatus.morningSpecial || (!isAdminLoggedIn && moCountdown.breakfastExpired),
                      disabledReason: !moSpecialStatus.morningSpecial ? 'এডমিন এক্টিভ করেনি' : moCountdown.breakfastExpired ? 'সময় শেষ' : '',
                      countdown: moCountdown.breakfast,
                      countdownExpired: moCountdown.breakfastExpired,
                      currentCount: curMS,
                    },
                    {
                      label: 'দুপুর স্পেশাল',
                      state: moLunchSpecial,
                      setter: setMoLunchSpecial,
                      disabled: !moSpecialStatus.lunchSpecial || (!isAdminLoggedIn && moCountdown.lunchExpired),
                      disabledReason: !moSpecialStatus.lunchSpecial ? 'এডমিন এক্টিভ করেনি' : moCountdown.lunchExpired ? 'সময় শেষ' : '',
                      countdown: moCountdown.lunch,
                      countdownExpired: moCountdown.lunchExpired,
                      currentCount: curLS,
                    },
                  ].map((item) => {
                    const isActive = (item.state as number) > 0;
                    const count = (item.state as number);
                    return (
                    <div key={item.label} className="flex items-stretch">
                      {/* +/- বাটন বাম পাশে */}
                      <div className="flex flex-col">
                        <button onClick={() => !item.disabled && (item.setter as any)((item.state as number) + 1)} disabled={item.disabled} className="w-7 h-[50%] rounded-tl-lg flex items-center justify-center text-sm font-bold border-2 border-b-0 border-r-0 border-slate-300 bg-slate-100 text-emerald-600 hover:bg-emerald-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">+</button>
                        <button onClick={() => !item.disabled && (item.setter as any)(Math.max(0, (item.state as number) - 1))} disabled={item.disabled} className="w-7 h-[50%] rounded-bl-lg flex items-center justify-center text-sm font-bold border-2 border-r-0 border-slate-300 bg-slate-100 text-red-500 hover:bg-red-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">−</button>
                      </div>
                      {/* নাম বক্স */}
                      <button
                        onClick={() => !item.disabled && (item.setter as any)((item.state as number) > 0 ? 0 : 1)}
                        disabled={item.disabled}
                        title={item.disabledReason || undefined}
                        className={`flex-1 rounded-tr-lg rounded-br-lg border-2 px-3 py-2.5 text-center cursor-pointer transition-all min-w-[90px] relative ${
                          item.disabled
                            ? 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                            : isActive
                              ? 'bg-emerald-500 text-white border-emerald-500 shadow-md'
                              : 'bg-white text-slate-600 border-slate-300 hover:border-emerald-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{item.label}</span>
                          <div className="flex items-center gap-1">
                            {isActive && !item.disabled && <span className="text-xs font-bold">+{count}</span>}
                            {!item.disabled && item.countdown && (
                              <span className={`text-[10px] font-mono ${item.countdownExpired ? 'text-red-400' : 'text-amber-600'}`}>
                                {item.countdown}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </div>
                    );
                  });
                  return <div className="grid grid-cols-2 gap-3">{btns}</div>;
                })()}
                {/* সময় উইন্ডো তথ্য */}
                {!isAdminLoggedIn && (
                  <div className="text-[11px] text-slate-500 space-y-0.5">
                    <p>⏰ সময়ের মধ্যে অর্ডার করুন — সকাল: {moCountdown.breakfastExpired ? <span className="text-red-500 font-medium">সময় শেষ!</span> : <span className="text-emerald-600 font-medium">{moCountdown.breakfast}</span>}</p>
                    <p>⏰ সময়ের মধ্যে অর্ডার করুন — দুপুর: {moCountdown.lunchExpired ? <span className="text-red-500 font-medium">সময় শেষ!</span> : <span className="text-emerald-600 font-medium">{moCountdown.lunch}</span>}</p>
                  </div>
                )}
                {moSpecialStatus.morningSpecial && !moCountdown.breakfastExpired && (
                  <p className="text-[11px] text-orange-600 bg-orange-50 px-2 py-1 rounded">🔥 {moOrderDate === todayBd.iso ? 'আজ' : moOrderDateParsed.display} তারিখের সকাল স্পেশাল নাস্তা চালু আছে তাই সকাল নাস্তা অর্ডার করা যাবে না</p>
                )}
                {moSpecialStatus.morningSpecial && moCountdown.breakfastExpired && (
                  <p className="text-[11px] text-red-600 bg-red-50 px-2 py-1 rounded font-medium">🔥 {moOrderDate === todayBd.iso ? 'আজ' : moOrderDateParsed.display} মিল অর্ডারের সময় শেষ। রাধুনীর সাথে যোগাযোগ করুন</p>
                )}
                {moSpecialStatus.lunchSpecial && !moCountdown.lunchExpired && (
                  <p className="text-[11px] text-orange-600 bg-orange-50 px-2 py-1 rounded">🔥 {moOrderDate === todayBd.iso ? 'আজ' : moOrderDateParsed.display} তারিখের দুপুর স্পেশাল মিল চালু আছে তাই দুপুর মিল অর্ডার করা যাবে না</p>
                )}
                {moSpecialStatus.lunchSpecial && moCountdown.lunchExpired && (
                  <p className="text-[11px] text-red-600 bg-red-50 px-2 py-1 rounded font-medium">🔥 {moOrderDate === todayBd.iso ? 'আজ' : moOrderDateParsed.display} মিল অর্ডারের সময় শেষ। রাধুনীর সাথে যোগাযোগ করুন</p>
                )}
                {/* Save Button */}
                <Button
                  onClick={handleMoSave}
                  disabled={moSaving}
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                >
                  {moSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                  {moSaving ? 'সেভ হচ্ছে...' : 'অর্ডার সেভ করুন'}
                </Button>

                {/* Selected Date Orders */}
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-slate-700">আমার অর্ডার ({moOrderDateParsed.display})</h3>
                    <Button variant="ghost" size="sm" onClick={fetchMoOrders} className="text-xs gap-1">
                      <RefreshCw className={`h-3 w-3 ${moOrdersLoading ? 'animate-spin' : ''}`} /> রিফ্রেশ
                    </Button>
                  </div>
                  {moOrdersLoading && !moOrdersLoaded && (
                    <div className="flex items-center justify-center py-6 text-slate-400">
                      <Loader2 className="h-5 w-5 animate-spin mr-2" /> লোড হচ্ছে...
                    </div>
                  )}
                  {!moOrdersLoading && moOrdersLoaded && moOrders.length === 0 && (
                    <div className="text-center py-6 text-slate-400 text-sm">কোনো অর্ডার নেই</div>
                  )}
                  {moOrders.length > 0 && (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 sticky top-0">
                            <tr className="border-b border-slate-200">
                              <th className="px-2 py-2 text-left font-medium text-slate-600">নাম</th>
                              <th className="px-2 py-2 text-left font-medium text-slate-600">পদবী</th>
                              <th className="px-2 py-2 text-center font-medium text-slate-600">সকাল</th>
                              <th className="px-2 py-2 text-center font-medium text-slate-600">দুপুর</th>
                              <th className="px-2 py-2 text-center font-medium text-slate-600">সকা.স্পে.</th>
                              <th className="px-2 py-2 text-center font-medium text-slate-600">দু.স্পে.</th>
                              <th className="px-2 py-2 text-center font-medium text-slate-600">অ্যাকশন</th>
                            </tr>
                          </thead>
                          <tbody>
                            {moOrders.map((order: any, idx: number) => (
                              <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-2 py-1.5 font-medium text-slate-700">{order.name || '—'}</td>
                                <td className="px-2 py-1.5 text-blue-600">{order.designation || '—'}</td>
                                <td className="px-2 py-1.5 text-center">{order.breakfast > 0 ? <span className="inline-flex items-center justify-center w-5 h-5 bg-emerald-100 text-emerald-700 font-bold rounded-full text-[10px]">{order.breakfast}</span> : '—'}</td>
                                <td className="px-2 py-1.5 text-center">{order.lunch > 0 ? <span className="inline-flex items-center justify-center w-5 h-5 bg-blue-100 text-blue-700 font-bold rounded-full text-[10px]">{order.lunch}</span> : '—'}</td>
                                <td className="px-2 py-1.5 text-center">{order.morningSpecial > 0 ? <span className="inline-flex items-center justify-center w-5 h-5 bg-orange-100 text-orange-700 font-bold rounded-full text-[10px]">{order.morningSpecial}</span> : '—'}</td>
                                <td className="px-2 py-1.5 text-center">{order.lunchSpecial > 0 ? <span className="inline-flex items-center justify-center w-5 h-5 bg-orange-100 text-orange-700 font-bold rounded-full text-[10px]">{order.lunchSpecial}</span> : '—'}</td>
                                <td className="px-2 py-1.5 text-center">
                                  {(() => {
                                    const hasBreakfast = order.breakfast || order.morningSpecial;
                                    const hasLunch = order.lunch || order.lunchSpecial;
                                    const canDeleteBreakfast = isAdminLoggedIn || !moCountdown.breakfastExpired;
                                    const canDeleteLunch = isAdminLoggedIn || !moCountdown.lunchExpired;
                                    const canDelete = (hasBreakfast && canDeleteBreakfast) || (hasLunch && canDeleteLunch);
                                    if (!canDelete) {
                                      return <span className="text-slate-300 text-[10px]">সময় শেষ</span>;
                                    }
                                    return (
                                      <button
                                        onClick={() => handleMoDeleteOrder(order.officeId)}
                                        className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded p-1"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    );
                                  })()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

            {/* ===== Tab 2: মিলের বিবরণ ===== */}
            <TabsContent value="summary" className="space-y-4 mt-4">
              {/* Month/Year Select */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">মাস</label>
                  <Select value={moSummaryMonth} onValueChange={setMoSummaryMonth}>
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="মাস নির্বাচন" />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS_NO_ALL.map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">বছর</label>
                  <Input
                    type="number"
                    value={moSummaryYear}
                    onChange={e => setMoSummaryYear(e.target.value)}
                    placeholder="বছর"
                    className="text-sm"
                  />
                </div>
              </div>
              <Button onClick={handleMoSummarySearch} disabled={moSummaryLoading} className="w-full bg-emerald-600 hover:bg-emerald-700">
                {moSummaryLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                {moSummaryLoading ? 'খুঁজছে...' : 'খুঁজুন'}
              </Button>

              {/* Summary Cards */}
              {moSummaryData && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Card className="p-2">
                      <div className="text-[11px] text-slate-500">সকাল নাস্তা</div>
                      <div className="text-base font-bold text-slate-800">{moSummaryData.totalBreakfast}</div>
                      <div className="text-[11px] text-slate-500">× {moSummaryData.breakfastPrice} Tk = <span className="font-medium text-slate-700">{moSummaryData.totalBreakfast * moSummaryData.breakfastPrice} Tk</span></div>
                    </Card>
                    <Card className="p-2">
                      <div className="text-[11px] text-slate-500">দুপুর মিল</div>
                      <div className="text-base font-bold text-slate-800">{moSummaryData.totalLunch}</div>
                      <div className="text-[11px] text-slate-500">× {moSummaryData.lunchPrice} Tk = <span className="font-medium text-slate-700">{moSummaryData.totalLunch * moSummaryData.lunchPrice} Tk</span></div>
                    </Card>
                    <Card className="p-2">
                      <div className="text-[11px] text-slate-500">সকাল স্পেশাল</div>
                      <div className="text-base font-bold text-slate-800">{moSummaryData.totalMorningSpecial}</div>
                      <div className="text-[11px] text-slate-500">× {moSummaryData.morningSpecialPrice} Tk = <span className="font-medium text-slate-700">{moSummaryData.totalMorningSpecial * moSummaryData.morningSpecialPrice} Tk</span></div>
                    </Card>
                    <Card className="p-2">
                      <div className="text-[11px] text-slate-500">দুপুর স্পেশাল</div>
                      <div className="text-base font-bold text-slate-800">{moSummaryData.totalLunchSpecial}</div>
                      <div className="text-[11px] text-slate-500">× {moSummaryData.lunchSpecialPrice} Tk = <span className="font-medium text-slate-700">{moSummaryData.totalLunchSpecial * moSummaryData.lunchSpecialPrice} Tk</span></div>
                    </Card>
                  </div>
                  {/* Grand Total */}
                  <Card className="p-4 bg-emerald-50 border-emerald-200">
                    <div className="text-center">
                      <div className="text-xs text-emerald-600 font-medium">মোট বিল</div>
                      <div className="text-2xl font-bold text-emerald-700">{moSummaryData.grandTotal} Tk</div>
                    </div>
                  </Card>

                  {/* Details Table */}
                  {moSummaryDetails.length > 0 && (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 sticky top-0">
                            <tr className="border-b border-slate-200">
                              <th className="px-2 py-2 text-left font-medium text-slate-600">ক্রমিক</th>
                              <th className="px-2 py-2 text-left font-medium text-slate-600">নাম</th>
                              <th className="px-2 py-2 text-left font-medium text-slate-600">পদবী</th>
                              <th className="px-2 py-2 text-center font-medium text-slate-600">সকাল</th>
                              <th className="px-2 py-2 text-center font-medium text-slate-600">দুপুর</th>
                              <th className="px-2 py-2 text-center font-medium text-slate-600">সকা.স্পে.</th>
                              <th className="px-2 py-2 text-center font-medium text-slate-600">দু.স্পে.</th>
                              <th className="px-2 py-2 text-right font-medium text-slate-600">বিল</th>
                            </tr>
                          </thead>
                          <tbody>
                            {moSummaryDetails.map((d: any, idx: number) => (
                              <tr key={d.officeId} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-2 py-1.5 text-slate-500">{idx + 1}</td>
                                <td className="px-2 py-1.5 font-medium">{d.name}</td>
                                <td className="px-2 py-1.5 text-slate-500">{d.designation || '—'}</td>
                                <td className="px-2 py-1.5 text-center"><span className={`inline-flex items-center justify-center min-w-[26px] h-[26px] rounded-full text-xs font-bold ${d.totalBreakfast > 0 ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : 'text-slate-300'}`}>{d.totalBreakfast}</span></td>
                                <td className="px-2 py-1.5 text-center"><span className={`inline-flex items-center justify-center min-w-[26px] h-[26px] rounded-full text-xs font-bold ${d.totalLunch > 0 ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'text-slate-300'}`}>{d.totalLunch}</span></td>
                                <td className="px-2 py-1.5 text-center"><span className={`inline-flex items-center justify-center min-w-[26px] h-[26px] rounded-full text-xs font-bold ${d.totalMorningSpecial > 0 ? 'bg-orange-100 text-orange-700 border border-orange-300' : 'text-slate-300'}`}>{d.totalMorningSpecial}</span></td>
                                <td className="px-2 py-1.5 text-center"><span className={`inline-flex items-center justify-center min-w-[26px] h-[26px] rounded-full text-xs font-bold ${d.totalLunchSpecial > 0 ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'text-slate-300'}`}>{d.totalLunchSpecial}</span></td>
                                <td className="px-2 py-1.5 text-right font-medium">{d.totalBill} Tk</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
      {/* Footer */}
      <footer className="mt-auto py-4 text-center text-sm text-slate-400 border-t border-slate-200 bg-white">
        অফিস মিল ম্যানেজমেন্ট সিস্টেম &copy; {new Date().getFullYear()}
        <br />
        <span className="text-xs text-slate-300">Created by Md. Mehedi hasan</span>
        <br />
        <span className="text-xs text-slate-300">Caretaker, Haripur 412 mw</span>
      </footer>
    </div>
  );
}
