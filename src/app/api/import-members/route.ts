import { NextRequest, NextResponse } from 'next/server';
import { db, query, batchQuery } from '@/lib/db';

// ===== বাংলা/ইংরেজি কলাম নাম → ডাটাবেজ ফিল্ড ম্যাপিং =====
// বিভিন্ন ভাষায়, বিভিন্ন বানানে, আংশিক মিলে — সব handle করে

const COLUMN_MAPPINGS: Array<{
  field: string;
  keywords: string[];       // কোন শব্দগুলো থাকলে ম্যাচ হবে
  exactMatches: string[];   // সঠিক কলাম নাম
}> = [
  {
    field: 'officeId',
    keywords: ['office', 'id', 'employee', 'emp', 'staff', 'oid', 'code', 'পরিচয়', 'আইডি', 'কোড', 'কর্মী', 'কর্মকর্তা'],
    exactMatches: [
      'office id', 'office-id', 'office_id', 'officeid',
      'employee id', 'employee-id', 'employee_id', 'employeeid',
      'emp id', 'emp-id', 'emp_id', 'empid',
      'staff id', 'staff-id', 'staff_id', 'staffid',
      'id',
      'কর্মকর্তার আইডি', 'অফিস আইডি', 'কর্মী আইডি', 'পরিচয় পত্র নম্বর', 'আইডি', 'কোড',
    ],
  },
  {
    field: 'name',
    keywords: ['name', 'নাম'],
    exactMatches: [
      'name', 'full name', 'full_name', 'fullname',
      'employee name', 'employee_name', 'employeename',
      'member name', 'member_name', 'membername',
      'নাম', 'পুরো নাম', 'সদস্যের নাম', 'কর্মীর নাম',
    ],
  },
  {
    field: 'designation',
    keywords: ['designat', 'title', 'position', 'role', 'post', 'পদ', 'বী'],
    exactMatches: [
      'designation', 'designation.', 'designation ',
      'job title', 'job_title', 'jobtitle',
      'position', 'role', 'post', 'title',
      'পদবী', 'পদবি', 'পদ', 'পদের নাম', 'কর্মপদ', 'পদবী.',
    ],
  },
  {
    field: 'mobile',
    keywords: ['mobile', 'phone', 'cell', 'contact', 'মোবাইল', 'ফোন', 'যোগাযোগ', 'সংযোগ', 'নম্বর'],
    exactMatches: [
      'mobile', 'mobile number', 'mobile_number', 'mobilenumber', 'mobile no', 'mobile no.', 'mobile_no',
      'phone', 'phone number', 'phone_number', 'phonenumber', 'phone no', 'phone no.', 'phone_no',
      'cell', 'cell phone', 'cellphone', 'cell no', 'cell_no',
      'contact', 'contact number', 'contact_number', 'contact no', 'contact no.',
      'tel', 'telephone', 'টেলিফোন',
      'মোবাইল', 'মোবাইল নম্বর', 'ফোন', 'ফোন নম্বর', 'যোগাযোগ', 'সংযোগ', 'সংযোগ নম্বর',
    ],
  },
  {
    field: 'department',
    keywords: ['department', 'dept', 'division', 'branch', 'unit', 'বিভাগ', 'শাখা', 'অধিশাসা'],
    exactMatches: [
      'department', 'dept', 'dept.', 'division', 'branch', 'unit', 'section',
      'বিভাগ', 'শাখা', 'বিভাগ/শাখা', 'অধিশায়ন',
    ],
  },
];

/**
 * একটি কলাম নামকে ডাটাবেজ ফিল্ডে ম্যাপ করে
 * - প্রথমে exact match চেক
 * - তারপর keyword-based partial match (আংশিক মিল)
 * - বাংলা/ইংরেজি দুই ভাষাতেই কাজ করে
 */
function mapColumnName(header: string): { field: string; confidence: number } | null {
  const normalized = header.trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');

  // ১. Exact match
  for (const mapping of COLUMN_MAPPINGS) {
    if (mapping.exactMatches.includes(normalized)) {
      return { field: mapping.field, confidence: 100 };
    }
  }

  // ২. Keyword-based partial match — কলাম নামে কোনো keyword থাকলে
  for (const mapping of COLUMN_MAPPINGS) {
    for (const keyword of mapping.keywords) {
      if (normalized.includes(keyword)) {
        // আংশিক মিলে confidence কম
        return { field: mapping.field, confidence: 70 + Math.round((keyword.length / normalized.length) * 30) };
      }
    }
  }

  return null;
}

/**
 * CSV পার্স — quoted values handle করে
 */
function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cols.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);
  return { headers, rows };
}

// Google Sheets URL থেকে Sheet ID বের করা
function extractSheetId(url: string): string | null {
  const patterns = [
    /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
    /\/d\/([a-zA-Z0-9-_]{20,})/,
  ];
  for (const p of patterns) {
    const match = url.match(p);
    if (match) return match[1];
  }
  return null;
}

/**
 * Google Sheet থেকে CSV ডাটা fetch করা
 */
async function fetchSheetCsv(sheetId: string, gid: string, sheetName: string): Promise<string> {
  const endpoints: string[] = [];
  if (gid) {
    endpoints.push(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`);
  } else if (sheetName) {
    endpoints.push(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`);
  } else {
    endpoints.push(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`);
  }
  endpoints.push(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`);

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/csv,text/html,*/*;q=0.8',
  };

  let lastError = '';
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { cache: 'no-store', headers, redirect: 'follow' });
      if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
      const text = await res.text();
      if (text.trimStart().startsWith('<!') || text.includes('<title>Error</title>')) {
        lastError = 'শীট পাবলিক নয়';
        continue;
      }
      if (text.trim().length < 5) { lastError = 'ফাঁকা রেসপন্স'; continue; }
      return text;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastError || 'শীট থেকে ডাটা আনা যায়নি');
}

// ===== GET: Preview — কলাম ম্যাপিং ও প্রিভিউ দেখানো =====
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'preview';
    const sheetUrl = searchParams.get('sheetUrl') || '';
    const sheetId = searchParams.get('sheetId') || '';
    const gid = searchParams.get('gid') || '';
    const sheetName = searchParams.get('sheetName') || '';

    const effectiveId = sheetId || extractSheetId(sheetUrl) || '';

    if (action === 'preview') {
      if (!effectiveId) {
        return NextResponse.json({ success: false, error: 'সঠিক Google Sheet URL দিন' });
      }

      const csvText = await fetchSheetCsv(effectiveId, gid, sheetName);
      const { headers, rows } = parseCsv(csvText);

      if (headers.length === 0 || rows.length === 0) {
        return NextResponse.json({ success: false, error: 'শীটে কোনো ডাটা নেই' });
      }

      // কলাম ম্যাপিং
      const columnMapping: Array<{ header: string; field: string | null; confidence: number }> = [];
      let officeIdFound = false;
      let nameFound = false;

      for (const header of headers) {
        const mapping = mapColumnName(header);
        if (mapping) {
          if (mapping.field === 'officeId') officeIdFound = true;
          if (mapping.field === 'name') nameFound = true;
          columnMapping.push({ header, field: mapping.field, confidence: mapping.confidence });
        } else {
          columnMapping.push({ header, field: null, confidence: 0 });
        }
      }

      // প্রতিটি রো-কে mapped object এ রূপান্তর
      const previewRows = rows.map((row, idx) => {
        const record: Record<string, string> = { _rowNumber: String(idx + 2) };
        for (let j = 0; j < headers.length; j++) {
          const mapping = mapColumnName(headers[j]);
          if (mapping && j < row.length) {
            record[mapping.field] = row[j];
          }
        }
        return record;
      }).filter(r => (r.officeId || '').trim() || (r.name || '').trim());

      // Raw preview — মূল কলাম নাম দিয়ে
      const rawPreview = rows.slice(0, 20).map((row, idx) => {
        const record: Record<string, string> = { _rowNumber: String(idx + 2) };
        for (let j = 0; j < headers.length; j++) {
          record[headers[j]] = j < row.length ? row[j] : '';
        }
        return record;
      });

      return NextResponse.json({
        success: true,
        totalRows: rows.length,
        validRows: previewRows.length,
        columnMapping,
        officeIdFound,
        nameFound,
        headers,
        preview: previewRows.slice(0, 20),
        rawPreview,
      });
    }

    // ডাটাবেজে আগে থেকে থাকা সদস্যদের অফিস আইডি লিস্ট
    if (action === 'existing') {
      const result = await query("SELECT DISTINCT officeId, name, mobile, designation FROM MealEntry WHERE officeId != '' ORDER BY officeId");
      const members = result.rows.map((row: any) => ({
        officeId: row.officeId,
        name: row.name,
        mobile: row.mobile,
        designation: row.designation || '',
      }));
      return NextResponse.json({ success: true, members });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ===== POST: Import — officeId চেক করে upsert =====
// db.mealEntry.create() এবং db.mealEntry.updateMany() ব্যবহার করে (raw SQL নয়)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sheetUrl, sheetId, gid, sheetName, rows, dryRun = false, columnMap } = body;

    // Sheet থেকে ডাটা আনা
    let effectiveRows: Array<Record<string, string>> = rows;

    if (!effectiveRows || effectiveRows.length === 0) {
      const effectiveId = sheetId || extractSheetId(sheetUrl || '') || '';
      if (!effectiveId) {
        return NextResponse.json({ success: false, error: 'সঠিক Google Sheet URL দিন অথবা রো ডাটা পাঠান' });
      }

      const csvText = await fetchSheetCsv(effectiveId, gid || '', sheetName || '');
      const { headers, rows: csvRows } = parseCsv(csvText);

      effectiveRows = csvRows.map((row) => {
        const record: Record<string, string> = {};
        for (let j = 0; j < headers.length; j++) {
          // ম্যানুয়াল columnMap আছে → সেটি ব্যবহার, না থাকলে অটো ম্যাপিং
          const manualField = columnMap && columnMap[headers[j]];
          if (manualField) {
            record[manualField] = row[j];
          } else if (!columnMap) {
            // Only auto-detect if no columnMap was provided
            const mapping = mapColumnName(headers[j]);
            if (mapping && j < row.length) {
              record[mapping.field] = row[j];
            }
          }
        }
        return record;
      }).filter(r => (r.officeId || '').trim() || (r.name || '').trim());
    }

    if (!effectiveRows || effectiveRows.length === 0) {
      return NextResponse.json({ success: false, error: 'ইমপোর্ট করার মতো কোনো ডাটা পাওয়া যায়নি' });
    }

    // Dry run — শুধু প্রিভিউ
    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        totalRows: effectiveRows.length,
        preview: effectiveRows.slice(0, 20),
      });
    }

    // ===== আসল ইমপোর্ট — Upsert Logic =====
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    const details: Array<{ officeId: string; name: string; action: string }> = [];

    // ডাটাবেজে আগে থেকে থাকা officeId গুলো একবারে আনা (db helper ব্যবহার)
    const allEntries = await db.mealEntry.findMany({ orderBy: { entryDate: 'desc' } });
    const existingMap = new Map<string, { name: string; mobile: string; designation: string }>();
    for (const entry of allEntries) {
      const oid = (entry.officeId || '').trim();
      if (!oid) continue;
      const existing = existingMap.get(oid.toLowerCase());
      // সবচেয়ে complete entry রাখুন (নাম, মোবাইল, পদবী সব থাকলে সেটি)
      const entryDesig = (entry as any).designation || '';
      const existingScore = existing ? (existing.name.length + existing.mobile.length + existing.designation.length) : 0;
      const newScore = (entry.name || '').length + (entry.mobile || '').length + entryDesig.length;
      if (!existing || newScore > existingScore) {
        existingMap.set(oid.toLowerCase(), {
          name: (entry.name || '').trim(),
          mobile: (entry.mobile || '').trim(),
          designation: entryDesig.trim(),
        });
      }
    }

    for (let i = 0; i < effectiveRows.length; i++) {
      const record = effectiveRows[i];
      const officeId = (record.officeId || '').trim();
      const name = (record.name || '').trim();
      const designation = (record.designation || '').trim();
      const mobile = (record.mobile || '').trim();

      if (!officeId) {
        errors.push(`রো ${i + 2}: অফিস আইডি নেই, বাদ দেওয়া হয়েছে`);
        skipped++;
        continue;
      }

      try {
        const existing = existingMap.get(officeId.toLowerCase());

        if (existing) {
          // ===== আপডেট: officeId আছে → নাম, পদবী, মোবাইল আপডেট (সব entry তে) =====
          const updateData: Record<string, string> = {};
          if (name) updateData.name = name;
          if (designation) updateData.designation = designation;
          if (mobile) updateData.mobile = mobile;

          if (Object.keys(updateData).length > 0) {
            await db.mealEntry.updateMany({
              where: { officeId },
              data: updateData,
            });
          }

          existingMap.set(officeId.toLowerCase(), {
            name: name || existing.name,
            mobile: mobile || existing.mobile,
            designation: designation || existing.designation,
          });

          updated++;
          details.push({ officeId, name: name || existing.name, action: 'আপডেট' });
        } else {
          // ===== নতুন এন্ট্রি: officeId নেই → নতুন সদস্য হিসেবে যোগ =====
          await db.mealEntry.create({
            data: {
              officeId,
              name,
              mobile,
              designation,
              month: '',
              year: '',
              breakfastCount: 0,
              lunchCount: 0,
              morningSpecial: 0,
              lunchSpecial: 0,
              totalBill: 0,
              deposit: 0,
              depositDate: '',
              prevBalance: 0,
              curBalance: 0,
            }
          });

          existingMap.set(officeId.toLowerCase(), { name, mobile, designation });
          created++;
          details.push({ officeId, name, action: 'নতুন যোগ' });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`রো ${i + 2} (${officeId}): ${msg}`);
        skipped++;
      }
    }

    return NextResponse.json({
      success: true,
      dryRun: false,
      totalRows: effectiveRows.length,
      created,
      updated,
      skipped,
      errors: errors.slice(0, 20),
      details: details.slice(0, 50),
      message: `সম্পন্ন: ${created}টি নতুন সদস্য যোগ, ${updated}টি আপডেট, ${skipped}টি বাদ`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
