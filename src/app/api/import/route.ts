import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// বাংলা/ইংরেজি কলাম নাম ম্যাপিং
const COLUMN_ALIASES: Record<string, string> = {
  // অফিস আইডি
  "office id": "officeId",
  "office-id": "officeId",
  "office_id": "officeId",
  "officeid": "officeId",
  "employee id": "officeId",
  "employee-id": "officeId",
  "employee_id": "officeId",
  "emp id": "officeId",
  "emp-id": "officeId",
  "emp_id": "officeId",
  "staff id": "officeId",
  "staff-id": "officeId",
  "staff_id": "officeId",
  "id": "officeId",
  "কর্মকর্তার আইডি": "officeId",
  "অফিস আইডি": "officeId",
  "কর্মী আইডি": "officeId",
  "পরিচয় পত্র নম্বর": "officeId",
  "আইডি": "officeId",
  "কোড": "officeId",

  // নাম
  "name": "name",
  "নাম": "name",
  "full name": "name",
  "full_name": "name",
  "employee name": "name",
  "employee_name": "name",
  "কর্মীর নাম": "name",
  "পুরো নাম": "name",
  "সদস্যের নাম": "name",

  // পদবী
  "designation": "designation",
  "title": "designation",
  "position": "designation",
  "role": "designation",
  "job title": "designation",
  "job_title": "designation",
  "পদবী": "designation",
  "পদ": "designation",
  "পদের নাম": "designation",
  "পদবি": "designation",
  "কর্মপদ": "designation",

  // মোবাইল
  "mobile": "mobile",
  "phone": "mobile",
  "phone number": "mobile",
  "phone_number": "mobile",
  "mobile number": "mobile",
  "mobile_number": "mobile",
  "contact": "mobile",
  "contact number": "mobile",
  "contact_number": "mobile",
  "cell": "mobile",
  "cell phone": "mobile",
  "মোবাইল": "mobile",
  "মোবাইল নম্বর": "mobile",
  "ফোন": "mobile",
  "ফোন নম্বর": "mobile",
  "যোগাযোগ": "mobile",
  "সংযোগ": "mobile",

  // বিভাগ
  "department": "department",
  "dept": "department",
  "division": "department",
  "বিভাগ": "department",
  "শাখা": "department",
  "বিভাগ/শাখা": "department",
};

/**
 * কলাম নাম normalize করে database field এ ম্যাপ করে
 */
function mapColumnName(header: string): string | null {
  const normalized = header.trim().toLowerCase();
  return COLUMN_ALIASES[normalized] || null;
}

/**
 * Google Sheets URL থেকে CSV data fetch করে
 */
async function fetchGoogleSheetCsv(sheetUrl: string): Promise<string> {
  // URL থেকে Sheet ID বের করা
  let sheetId = "";

  // বিভিন্ন Google Sheets URL format handle করা
  const patterns = [
    /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
    /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
    /\/d\/([a-zA-Z0-9-_]+)\/edit/,
    /\/d\/([a-zA-Z0-9-_]+)\/pub/,
  ];

  for (const pattern of patterns) {
    const match = sheetUrl.match(pattern);
    if (match) {
      sheetId = match[1];
      break;
    }
  }

  if (!sheetId) {
    throw new Error(
      "সঠিক Google Sheets URL দিন। উদাহরণ: https://docs.google.com/spreadsheets/d/SHEET_ID/edit"
    );
  }

  // কি নির্দিষ্ট sheet আছে কিনা চেক করা (gid parameter)
  let gid = "0";
  const gidMatch = sheetUrl.match(/gid=(\d+)/);
  if (gidMatch) {
    gid = gidMatch[1];
  }

  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

  const response = await fetch(csvUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Google Sheets থেকে ডাটা আনতে সমস্যা হয়েছে। নিশ্চিত করুন শিটটি "Anyone with the link" দিয়ে accessible আছে। (HTTP ${response.status})`
    );
  }

  return await response.text();
}

/**
 * CSV parse করে rows array তে রূপান্তর করে
 */
function parseCsv(csvText: string): { headers: string[]; rows: string[][] } {
  const lines = csvText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error("শিটে পর্যাপ্ত ডাটা নেই। কমপক্ষে হেডার এবং একটি ডাটা রো থাকতে হবে।");
  }

  // CSV parse (comma separated, handle quoted values)
  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(parseRow);

  return { headers, rows };
}

/**
 * CSV data কে mapped objects এ রূপান্তর করে
 */
function mapRowsToRecords(
  headers: string[],
  rows: string[][]
): { records: Record<string, string>[]; columnMap: Record<string, string>; warnings: string[] } {
  const columnMap: Record<string, string> = {};
  const warnings: string[] = [];

  // কলাম ম্যাপিং
  for (const header of headers) {
    const mapped = mapColumnName(header);
    if (mapped) {
      columnMap[header] = mapped;
    } else {
      warnings.push(`কলাম "${header}" চেনা যায়নি, এটি উপেক্ষা করা হয়েছে।`);
    }
  }

  if (!columnMap[headers.find((h) => mapColumnName(h) === "officeId") || ""]) {
    throw new Error(
      "অফিস আইডি কলাম পাওয়া যায়নি। অনুগ্রহ করে নিশ্চিত করুন শিটে 'Office ID', 'Employee ID', 'অফিস আইডি' ইত্যাদি কলাম আছে।"
    );
  }

  // Row গুলোকে object এ রূপান্তর
  const records: Record<string, string>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const record: Record<string, string> = {};

    for (let j = 0; j < headers.length; j++) {
      const mappedField = columnMap[headers[j]];
      if (mappedField && j < row.length) {
        record[mappedField] = row[j];
      }
    }

    records.push(record);
  }

  return { records, columnMap, warnings };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sheetUrl, dryRun = false } = body;

    if (!sheetUrl || typeof sheetUrl !== "string") {
      return NextResponse.json(
        { success: false, error: "Google Sheets URL দিন।" },
        { status: 400 }
      );
    }

    // Google Sheets থেকে CSV fetch
    const csvText = await fetchGoogleSheetCsv(sheetUrl);

    // CSV parse
    const { headers, rows } = parseCsv(csvText);

    // Records এ ম্যাপ
    const { records, columnMap, warnings } = mapRowsToRecords(headers, rows);

    // Dry run - শুধু preview দেখাও
    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        totalRecords: records.length,
        columnMap,
        warnings,
        preview: records.slice(0, 10),
      });
    }

    // আসল ইমপোর্ট - upsert logic
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const { officeId, name, designation, mobile, department } = record;

      if (!officeId || !name) {
        errors.push(`রো ${i + 2}: অফিস আইডি বা নাম খালি, এটি বাদ দেওয়া হয়েছে।`);
        skipped++;
        continue;
      }

      try {
        // ডাটাবেজে অফিস আইডি চেক করা
        const existing = await db.officeMember.findUnique({
          where: { officeId },
        });

        if (existing) {
          // আপডেট - নাম, পদবী, মোবাইল আপডেট হবে
          await db.officeMember.update({
            where: { officeId },
            data: {
              name: name || existing.name,
              designation:
                designation !== undefined ? designation : existing.designation,
              mobile: mobile !== undefined ? mobile : existing.mobile,
              department:
                department !== undefined ? department : existing.department,
            },
          });
          updated++;
        } else {
          // নতুন এন্ট্রি
          await db.officeMember.create({
            data: {
              officeId,
              name,
              designation: designation || null,
              mobile: mobile || null,
              department: department || null,
            },
          });
          created++;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`রো ${i + 2}: ${message}`);
        skipped++;
      }
    }

    return NextResponse.json({
      success: true,
      dryRun: false,
      totalRecords: records.length,
      created,
      updated,
      skipped,
      columnMap,
      warnings,
      errors,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function GET() {
  // সব সদস্যদের লিস্ট দেখানো
  const members = await db.officeMember.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ success: true, members });
}
