// src/app/api/citizen-reporting/metrics/route.ts
//
// Metrics endpoint for AI triage evaluation
// - GET: AI triage metrics (admin only)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing Supabase env vars: " +
    (!supabaseUrl ? "NEXT_PUBLIC_SUPABASE_URL " : "") +
    (!serviceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY" : "")
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const ADMIN_ROLES = [
  'admin', 'old_terminal', 'new_terminal', 'taxi', 'tourism',
  'hotel', 'health', 'pharmacy', 'emergency', 'church', 'government_fleet'
];

export async function GET(req: NextRequest) {
  console.log("[citizen-reporting][METRICS] Fetching AI triage metrics");

  const adminFirebaseUid = req.nextUrl.searchParams.get("adminFirebaseUid");

  // Require adminFirebaseUid for metrics
  if (!adminFirebaseUid) {
    console.error("[citizen-reporting][METRICS] Missing adminFirebaseUid");
    return NextResponse.json(
      { error: "adminFirebaseUid is required" },
      { status: 400 }
    );
  }

  // Verify admin role (same pattern as GET)
  const { data: adminUser, error: adminLookupError } = await supabase
    .from("users")
    .select("role")
    .eq("firebase_uid", adminFirebaseUid)
    .maybeSingle();

  if (adminLookupError || !adminUser) {
    console.error("[citizen-reporting][METRICS] Admin lookup failed:", adminLookupError?.message);
    return NextResponse.json({ error: "Unable to verify admin access" }, { status: 403 });
  }

  if (!ADMIN_ROLES.includes(adminUser.role)) {
    console.error("[citizen-reporting][METRICS] User lacks admin role:", adminFirebaseUid, adminUser.role);
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  console.log("[citizen-reporting][METRICS] Admin access verified for:", adminFirebaseUid);

  try {
    // Get all reports with relevant fields
    const { data: reports, error } = await supabase
      .from("citizen_reports")
      .select("status, category, ai_status, ai_category, final_category, created_at, assigned_at, resolved_at");

    if (error) {
      console.error("[citizen-reporting][METRICS] Query error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!reports || reports.length === 0) {
      return NextResponse.json({
        total: 0,
        byStatus: {},
        byCategory: {},
        medianHoursToAssign: null,
        medianHoursToResolve: null,
        ai: { done: 0, failed: 0, skipped: 0, agreementRate: null },
      }, { status: 200 });
    }

    // Calculate totals
    const total = reports.length;

    // By status
    const byStatus: Record<string, number> = {};
    reports.forEach(r => {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    });

    // By category
    const byCategory: Record<string, number> = {};
    reports.forEach(r => {
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    });

    // Calculate median hours to assign
    const assignedReports = reports.filter(r => r.assigned_at && r.created_at);
    const hoursToAssign = assignedReports.map(r => {
      const created = new Date(r.created_at).getTime();
      const assigned = new Date(r.assigned_at).getTime();
      return (assigned - created) / (1000 * 60 * 60); // hours
    }).sort((a, b) => a - b);
    const medianHoursToAssign = hoursToAssign.length > 0
      ? hoursToAssign[Math.floor(hoursToAssign.length / 2)]
      : null;

    // Calculate median hours to resolve
    const resolvedReports = reports.filter(r => r.resolved_at && r.created_at);
    const hoursToResolve = resolvedReports.map(r => {
      const created = new Date(r.created_at).getTime();
      const resolved = new Date(r.resolved_at).getTime();
      return (resolved - created) / (1000 * 60 * 60); // hours
    }).sort((a, b) => a - b);
    const medianHoursToResolve = hoursToResolve.length > 0
      ? hoursToResolve[Math.floor(hoursToResolve.length / 2)]
      : null;

    // AI metrics
    const aiDone = reports.filter(r => r.ai_status === 'done').length;
    const aiFailed = reports.filter(r => r.ai_status === 'failed').length;
    const aiSkipped = reports.filter(r => r.ai_status === 'skipped').length;

    // Agreement rate: share of reports with final_category where ai_category equals final_category
    const reportsWithFinal = reports.filter(r => r.final_category && r.ai_category);
    const agreements = reportsWithFinal.filter(r => r.ai_category === r.final_category).length;
    const agreementRate = reportsWithFinal.length > 0
      ? agreements / reportsWithFinal.length
      : null;

    return NextResponse.json({
      total,
      byStatus,
      byCategory,
      medianHoursToAssign: medianHoursToAssign ? Math.round(medianHoursToAssign * 100) / 100 : null,
      medianHoursToResolve: medianHoursToResolve ? Math.round(medianHoursToResolve * 100) / 100 : null,
      ai: {
        done: aiDone,
        failed: aiFailed,
        skipped: aiSkipped,
        agreementRate: agreementRate ? Math.round(agreementRate * 1000) / 1000 : null,
      },
    }, { status: 200 });

  } catch (error) {
    console.error("[citizen-reporting][METRICS] Error:", error);
    return NextResponse.json({ error: "Failed to calculate metrics" }, { status: 500 });
  }
}
