// src/app/api/citizen-reporting/route.ts
//
// API endpoint for citizen reporting feature
// - POST: Create a new citizen report
// - GET: List reports (user's own or admin view)
// - PATCH: Update report status
// - GET /metrics: AI triage metrics (admin only)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { triageReport } from "@/lib/ai/triage";
import { requireCallerWithEnforce } from "@/lib/auth/verify";

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

type CreateReportPayload = {
  firebaseUid: string;
  category: 'pothole' | 'garbage' | 'street_light' | 'water' | 'other';
  description?: string;
  photoUrl?: string;
  latitude: number;
  longitude: number;
};

type UpdateStatusPayload = {
  reportId: string;
  status: 'pending' | 'in_progress' | 'resolved';
  finalCategory?: 'pothole' | 'garbage' | 'street_light' | 'water' | 'other';
  finalUrgency?: 'low' | 'medium' | 'high';
};

const VALID_CATEGORIES = ['pothole', 'garbage', 'street_light', 'water', 'other'] as const;
const VALID_STATUSES = ['pending', 'in_progress', 'resolved'] as const;

export async function POST(req: NextRequest) {
  console.log("[citizen-reporting][POST] Creating new citizen report");

  let payload: CreateReportPayload;
  try {
    payload = await req.json();
  } catch {
    console.error("[citizen-reporting][POST] Invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate required fields
  if (!payload.firebaseUid) {
    console.error("[citizen-reporting][POST] Missing firebaseUid");
    return NextResponse.json(
      { error: "firebaseUid is required" },
      { status: 400 }
    );
  }

  // Auth check: caller.uid must equal firebaseUid
  const authResult = await requireCallerWithEnforce(req, {
    uid: payload.firebaseUid,
    route: '/api/citizen-reporting',
    method: 'POST',
  });

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.status }
    );
  }

  if (!payload.category) {
    console.error("[citizen-reporting][POST] Missing category");
    return NextResponse.json(
      { error: "category is required" },
      { status: 400 }
    );
  }

  if (!VALID_CATEGORIES.includes(payload.category)) {
    console.error("[citizen-reporting][POST] Invalid category:", payload.category);
    return NextResponse.json(
      { error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` },
      { status: 400 }
    );
  }

  if (payload.latitude === undefined || payload.latitude === null) {
    console.error("[citizen-reporting][POST] Missing latitude");
    return NextResponse.json(
      { error: "latitude is required" },
      { status: 400 }
    );
  }

  if (payload.longitude === undefined || payload.longitude === null) {
    console.error("[citizen-reporting][POST] Missing longitude");
    return NextResponse.json(
      { error: "longitude is required" },
      { status: 400 }
    );
  }

  // Validate latitude/longitude ranges
  if (payload.latitude < -90 || payload.latitude > 90) {
    console.error("[citizen-reporting][POST] Invalid latitude:", payload.latitude);
    return NextResponse.json(
      { error: "latitude must be between -90 and 90" },
      { status: 400 }
    );
  }

  if (payload.longitude < -180 || payload.longitude > 180) {
    console.error("[citizen-reporting][POST] Invalid longitude:", payload.longitude);
    return NextResponse.json(
      { error: "longitude must be between -180 and 180" },
      { status: 400 }
    );
  }

  console.log("[citizen-reporting][POST] Inserting report for firebaseUid:", payload.firebaseUid);

  // Insert the report
  const { data, error } = await supabase
    .from("citizen_reports")
    .insert({
      reporter_firebase_uid: payload.firebaseUid,
      category: payload.category,
      description: payload.description || null,
      photo_url: payload.photoUrl || null,
      latitude: payload.latitude,
      longitude: payload.longitude,
      status: 'pending',
    })
    .select("*")
    .single();

  if (error) {
    console.error("[citizen-reporting][POST] Insert error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log("[citizen-reporting][POST] Report created successfully, ID:", data.id);

  // Attempt AI triage (non-blocking)
  try {
    const triageResult = await triageReport({
      description: payload.description || '',
      category: payload.category,
    });

    if (triageResult) {
      // AI triage succeeded - update the report with AI suggestions
      const { error: updateError } = await supabase
        .from("citizen_reports")
        .update({
          ai_status: 'done',
          ai_category: triageResult.category,
          ai_urgency: triageResult.urgency,
          ai_summary: triageResult.summary,
          ai_language: triageResult.language,
          ai_confidence: triageResult.confidence,
          ai_model: 'gemini-1.5-flash',
          triaged_at: new Date().toISOString(),
        })
        .eq("id", data.id);

      if (updateError) {
        console.error("[citizen-reporting][POST] Failed to update AI triage results:", updateError.message);
      } else {
        console.log("[citizen-reporting][POST] AI triage completed for report:", data.id);
      }
    } else {
      // AI triage failed or was skipped - mark as failed/skipped
      const hasApiKey = !!process.env.GEMINI_API_KEY;
      const aiStatus = hasApiKey ? 'failed' : 'skipped';
      
      const { error: updateError } = await supabase
        .from("citizen_reports")
        .update({ ai_status: aiStatus })
        .eq("id", data.id);

      if (updateError) {
        console.error("[citizen-reporting][POST] Failed to update AI status:", updateError.message);
      } else {
        console.log("[citizen-reporting][POST] AI triage marked as", aiStatus, "for report:", data.id);
      }
    }
  } catch (triageError) {
    // AI triage error should not fail the entire request
    console.error("[citizen-reporting][POST] AI triage error (non-blocking):", triageError);
    
    // Mark as failed
    await supabase
      .from("citizen_reports")
      .update({ ai_status: 'failed' })
      .eq("id", data.id);
  }

  // Return the created report (AI fields may not be updated yet due to async nature)
  return NextResponse.json({ report: data }, { status: 201 });
}

export async function GET(req: NextRequest) {
  console.log("[citizen-reporting][GET] Fetching citizen reports");

  const firebaseUid = req.nextUrl.searchParams.get("firebaseUid");
  const admin = req.nextUrl.searchParams.get("admin");
  const adminFirebaseUid = req.nextUrl.searchParams.get("adminFirebaseUid");
  const status = req.nextUrl.searchParams.get("status");

  // Require either firebaseUid or admin=true (with adminFirebaseUid)
  if (!firebaseUid && admin !== "true") {
    console.error("[citizen-reporting][GET] Missing required query parameter (firebaseUid or admin=true with adminFirebaseUid)");
    return NextResponse.json(
      { error: "Either firebaseUid query parameter or admin=true (with adminFirebaseUid) is required" },
      { status: 400 }
    );
  }

  // Auth check
  if (firebaseUid) {
    // User mode: caller.uid must equal firebaseUid
    const authResult = await requireCallerWithEnforce(req, {
      uid: firebaseUid,
      route: '/api/citizen-reporting',
      method: 'GET',
    });

    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status }
      );
    }
  } else if (admin === "true" && adminFirebaseUid) {
    // Admin mode: caller must be admin and caller.uid must equal adminFirebaseUid
    const authResult = await requireCallerWithEnforce(req, {
      uid: adminFirebaseUid,
      adminOnly: true,
      route: '/api/citizen-reporting',
      method: 'GET',
    });

    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status }
      );
    }
  }

  let query = supabase
    .from("citizen_reports")
    .select("*")
    .order("created_at", { ascending: false });

  // User mode: get only their own reports
  if (firebaseUid) {
    console.log("[citizen-reporting][GET] Fetching reports for firebaseUid:", firebaseUid);
    query = query.eq("reporter_firebase_uid", firebaseUid);
  }

  // Admin mode: get all reports, optionally filtered by status
  if (admin === "true") {
    if (!adminFirebaseUid) {
      console.error("[citizen-reporting][GET] admin=true requires adminFirebaseUid");
      return NextResponse.json(
        { error: "adminFirebaseUid is required when admin=true" },
        { status: 400 }
      );
    }

    const { data: adminUser, error: adminLookupError } = await supabase
      .from("users")
      .select("role")
      .eq("firebase_uid", adminFirebaseUid)
      .maybeSingle();

    if (adminLookupError || !adminUser) {
      console.error("[citizen-reporting][GET] Admin lookup failed:", adminLookupError?.message);
      return NextResponse.json({ error: "Unable to verify admin access" }, { status: 403 });
    }

    // Admin roles from the Flutter UserModel enum (canonical role strings)
    const ADMIN_ROLES = [
      'admin',           // superAdmin
      'old_terminal',    // oldTerminalAdmin
      'new_terminal',    // newTerminalAdmin
      'taxi',            // taxiAdmin
      'tourism',         // tourismAdmin
      'hotel',           // hotelAdmin
      'health',          // healthAdmin
      'pharmacy',        // pharmacyAdmin
      'emergency',       // emergencyAdmin
      'church',          // churchAdmin
      'government_fleet' // governmentFleetAdmin
    ];

    if (!ADMIN_ROLES.includes(adminUser.role)) {
      console.error("[citizen-reporting][GET] User lacks admin role:", adminFirebaseUid, adminUser.role);
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    console.log("[citizen-reporting][GET] Admin access verified for:", adminFirebaseUid, "role:", adminUser.role);

    if (status) {
      if (!VALID_STATUSES.includes(status as any)) {
        console.error("[citizen-reporting][GET] Invalid status:", status);
        return NextResponse.json(
          { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
          { status: 400 }
        );
      }
      console.log("[citizen-reporting][GET] Filtering by status:", status);
      query = query.eq("status", status);
    }
  }

  const { data, error } = await query;

  if (error) {
    console.error("[citizen-reporting][GET] Query error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log("[citizen-reporting][GET] Retrieved", data.length, "reports");
  return NextResponse.json({ reports: data }, { status: 200 });
}

export async function PATCH(req: NextRequest) {
  console.log("[citizen-reporting][PATCH] Updating report status");

  // Auth check: admin only
  const authResult = await requireCallerWithEnforce(req, {
    adminOnly: true,
    route: '/api/citizen-reporting',
    method: 'PATCH',
  });

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.status }
    );
  }

  let payload: UpdateStatusPayload;
  try {
    payload = await req.json();
  } catch {
    console.error("[citizen-reporting][PATCH] Invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate required fields
  if (!payload.reportId) {
    console.error("[citizen-reporting][PATCH] Missing reportId");
    return NextResponse.json(
      { error: "reportId is required" },
      { status: 400 }
    );
  }

  if (!payload.status) {
    console.error("[citizen-reporting][PATCH] Missing status");
    return NextResponse.json(
      { error: "status is required" },
      { status: 400 }
    );
  }

  if (!VALID_STATUSES.includes(payload.status)) {
    console.error("[citizen-reporting][PATCH] Invalid status:", payload.status);
    return NextResponse.json(
      { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 }
    );
  }

  // Validate optional finalCategory
  if (payload.finalCategory && !VALID_CATEGORIES.includes(payload.finalCategory)) {
    console.error("[citizen-reporting][PATCH] Invalid finalCategory:", payload.finalCategory);
    return NextResponse.json(
      { error: `finalCategory must be one of: ${VALID_CATEGORIES.join(', ')}` },
      { status: 400 }
    );
  }

  // Validate optional finalUrgency
  const VALID_URGENCY = ['low', 'medium', 'high'] as const;
  if (payload.finalUrgency && !VALID_URGENCY.includes(payload.finalUrgency)) {
    console.error("[citizen-reporting][PATCH] Invalid finalUrgency:", payload.finalUrgency);
    return NextResponse.json(
      { error: `finalUrgency must be one of: ${VALID_URGENCY.join(', ')}` },
      { status: 400 }
    );
  }

  console.log("[citizen-reporting][PATCH] Updating report", payload.reportId, "to status:", payload.status);

  // Build update object
  const updateData: any = {
    status: payload.status,
    updated_at: new Date().toISOString(),
  };

  // Set assigned_at when status becomes 'in_progress' (if not already set)
  if (payload.status === 'in_progress') {
    updateData.assigned_at = new Date().toISOString();
  }

  // Set resolved_at when status becomes 'resolved'
  if (payload.status === 'resolved') {
    updateData.resolved_at = new Date().toISOString();
  }

  // Set final category and urgency if provided (admin override)
  if (payload.finalCategory) {
    updateData.final_category = payload.finalCategory;
  }
  if (payload.finalUrgency) {
    updateData.final_urgency = payload.finalUrgency;
  }

  // Update the report
  const { data, error } = await supabase
    .from("citizen_reports")
    .update(updateData)
    .eq("id", payload.reportId)
    .select("*")
    .single();

  if (error) {
    console.error("[citizen-reporting][PATCH] Update error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    console.error("[citizen-reporting][PATCH] Report not found:", payload.reportId);
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  console.log("[citizen-reporting][PATCH] Report updated successfully");
  return NextResponse.json({ report: data }, { status: 200 });
}
