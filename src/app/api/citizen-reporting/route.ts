// src/app/api/citizen-reporting/route.ts
//
// API endpoint for citizen reporting:
// - POST: create a report, then triage it with Gemini (failure never fails the request)
// - GET: list reports for one citizen, or all reports for an admin
// - PATCH: admin status update and category/urgency override

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api/errors";
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

const VALID_CATEGORIES = ['pothole', 'garbage', 'street_light', 'water', 'other'] as const;
const VALID_STATUSES = ['pending', 'in_progress', 'resolved'] as const;
const VALID_URGENCY = ['low', 'medium', 'high'] as const;
const LIST_LIMIT = 200;

type CreateReportPayload = {
  firebaseUid: string;
  category: typeof VALID_CATEGORIES[number];
  description?: string;
  photoUrl?: string;
  latitude: number;
  longitude: number;
};

type UpdateReportPayload = {
  reportId: string;
  status?: typeof VALID_STATUSES[number];
  finalCategory?: typeof VALID_CATEGORIES[number];
  finalUrgency?: typeof VALID_URGENCY[number];
};

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export async function POST(req: NextRequest) {
  let payload: CreateReportPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(apiError('invalid_json', 'Invalid JSON body'), { status: 400 });
  }

  if (!payload.firebaseUid) {
    return NextResponse.json(
      apiError('validation_failed', 'firebaseUid is required'),
      { status: 400 },
    );
  }

  const authResult = await requireCallerWithEnforce(req, {
    uid: payload.firebaseUid,
    route: '/api/citizen-reporting',
    method: 'POST',
  });
  if (!authResult.ok) {
    return NextResponse.json(
      apiError(authResult.status === 403 ? 'forbidden' : 'unauthorized', authResult.error ?? 'Unauthorized'),
      { status: authResult.status },
    );
  }

  if (!isOneOf(payload.category, VALID_CATEGORIES)) {
    return NextResponse.json(
      apiError('validation_failed', `category must be one of: ${VALID_CATEGORIES.join(', ')}`),
      { status: 400 },
    );
  }

  if (
    typeof payload.latitude !== 'number' ||
    typeof payload.longitude !== 'number' ||
    !Number.isFinite(payload.latitude) ||
    !Number.isFinite(payload.longitude) ||
    payload.latitude < -90 ||
    payload.latitude > 90 ||
    payload.longitude < -180 ||
    payload.longitude > 180
  ) {
    return NextResponse.json(
      apiError('validation_failed', 'latitude/longitude must be valid coordinates'),
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("citizen_reports")
    .insert({
      reporter_firebase_uid: payload.firebaseUid,
      category: payload.category,
      description: payload.description?.trim() || null,
      photo_url: payload.photoUrl || null,
      latitude: payload.latitude,
      longitude: payload.longitude,
      status: 'pending',
    })
    .select("*")
    .single();

  if (error) {
    console.error("[citizen-reporting][POST] Insert failed:", error.message);
    return NextResponse.json(
      apiError('storage_error', 'Unable to save the report'),
      { status: 503 },
    );
  }

  try {
    const triageResult = await triageReport({
      description: payload.description || '',
      category: payload.category,
    });

    if (triageResult) {
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
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id);

      if (updateError) {
        console.error("[citizen-reporting][POST] Failed to store triage:", updateError.message);
      }
    } else {
      const aiStatus = process.env.GEMINI_API_KEY ? 'failed' : 'skipped';
      const { error: updateError } = await supabase
        .from("citizen_reports")
        .update({ ai_status: aiStatus, updated_at: new Date().toISOString() })
        .eq("id", data.id);

      if (updateError) {
        console.error("[citizen-reporting][POST] Failed to store AI status:", updateError.message);
      }
    }
  } catch (triageError) {
    console.error("[citizen-reporting][POST] Triage error (non-fatal):", triageError);
    await supabase
      .from("citizen_reports")
      .update({ ai_status: 'failed', updated_at: new Date().toISOString() })
      .eq("id", data.id);
  }

  // Return the stored row so the client sees the AI fields immediately.
  const { data: stored, error: reloadError } = await supabase
    .from("citizen_reports")
    .select("*")
    .eq("id", data.id)
    .maybeSingle();
  if (reloadError) {
    console.error("[citizen-reporting][POST] Reload failed:", reloadError.message);
  }

  return NextResponse.json({ report: stored ?? data }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const firebaseUid = req.nextUrl.searchParams.get("firebaseUid");
  const admin = req.nextUrl.searchParams.get("admin");
  const adminFirebaseUid = req.nextUrl.searchParams.get("adminFirebaseUid");
  const status = req.nextUrl.searchParams.get("status");
  const updatedSinceRaw = req.nextUrl.searchParams.get("updatedSince");

  if (!firebaseUid && admin !== "true") {
    return NextResponse.json(
      apiError('validation_failed', 'firebaseUid or admin=true is required'),
      { status: 400 },
    );
  }

  let updatedSince: string | null = null;
  if (updatedSinceRaw) {
    const parsed = new Date(updatedSinceRaw);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        apiError('validation_failed', 'updatedSince must be an ISO timestamp'),
        { status: 400 },
      );
    }
    updatedSince = parsed.toISOString();
  }

  if (status && !isOneOf(status, VALID_STATUSES)) {
    return NextResponse.json(
      apiError('validation_failed', `status must be one of: ${VALID_STATUSES.join(', ')}`),
      { status: 400 },
    );
  }

  if (firebaseUid) {
    const authResult = await requireCallerWithEnforce(req, {
      uid: firebaseUid,
      route: '/api/citizen-reporting',
      method: 'GET',
    });
    if (!authResult.ok) {
      return NextResponse.json(
        apiError(authResult.status === 403 ? 'forbidden' : 'unauthorized', authResult.error ?? 'Unauthorized'),
        { status: authResult.status },
      );
    }
  } else {
    const authResult = await requireCallerWithEnforce(req, {
      adminOnly: true,
      route: '/api/citizen-reporting',
      method: 'GET',
    });
    if (!authResult.ok) {
      return NextResponse.json(
        apiError(authResult.status === 403 ? 'forbidden' : 'unauthorized', authResult.error ?? 'Unauthorized'),
        { status: authResult.status },
      );
    }
    if (
      adminFirebaseUid &&
      authResult.caller &&
      adminFirebaseUid !== authResult.caller.uid
    ) {
      return NextResponse.json(
        apiError('forbidden', 'Forbidden: UID mismatch'),
        { status: 403 },
      );
    }
  }

  // Capture the watermark before querying so a row changed during the query
  // is not skipped by the next incremental poll.
  const serverTime = new Date().toISOString();

  let query = supabase
    .from("citizen_reports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (firebaseUid) {
    query = query.eq("reporter_firebase_uid", firebaseUid);
  }
  if (admin === "true" && status) {
    query = query.eq("status", status);
  }
  if (updatedSince) {
    query = query.gt("updated_at", updatedSince);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[citizen-reporting][GET] Query failed:", error.message);
    return NextResponse.json(
      apiError('storage_error', 'Unable to load reports'),
      { status: 503 },
    );
  }

  return NextResponse.json(
    { reports: data ?? [], serverTime },
    { status: 200 },
  );
}

export async function PATCH(req: NextRequest) {
  const authResult = await requireCallerWithEnforce(req, {
    adminOnly: true,
    route: '/api/citizen-reporting',
    method: 'PATCH',
  });
  if (!authResult.ok) {
    return NextResponse.json(
      apiError(authResult.status === 403 ? 'forbidden' : 'unauthorized', authResult.error ?? 'Unauthorized'),
      { status: authResult.status },
    );
  }

  let payload: UpdateReportPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(apiError('invalid_json', 'Invalid JSON body'), { status: 400 });
  }

  if (!payload.reportId) {
    return NextResponse.json(
      apiError('validation_failed', 'reportId is required'),
      { status: 400 },
    );
  }

  if (!payload.status && !payload.finalCategory && !payload.finalUrgency) {
    return NextResponse.json(
      apiError('validation_failed', 'status, finalCategory or finalUrgency is required'),
      { status: 400 },
    );
  }

  if (payload.status !== undefined && !isOneOf(payload.status, VALID_STATUSES)) {
    return NextResponse.json(
      apiError('validation_failed', `status must be one of: ${VALID_STATUSES.join(', ')}`),
      { status: 400 },
    );
  }

  if (payload.finalCategory !== undefined && !isOneOf(payload.finalCategory, VALID_CATEGORIES)) {
    return NextResponse.json(
      apiError('validation_failed', `finalCategory must be one of: ${VALID_CATEGORIES.join(', ')}`),
      { status: 400 },
    );
  }

  if (payload.finalUrgency !== undefined && !isOneOf(payload.finalUrgency, VALID_URGENCY)) {
    return NextResponse.json(
      apiError('validation_failed', `finalUrgency must be one of: ${VALID_URGENCY.join(', ')}`),
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const updateData: Record<string, string> = { updated_at: now };

  if (payload.status) {
    updateData.status = payload.status;
    if (payload.status === 'in_progress') {
      updateData.assigned_at = now;
    }
    if (payload.status === 'resolved') {
      updateData.resolved_at = now;
    }
  }
  if (payload.finalCategory) {
    updateData.final_category = payload.finalCategory;
  }
  if (payload.finalUrgency) {
    updateData.final_urgency = payload.finalUrgency;
  }

  const { data, error } = await supabase
    .from("citizen_reports")
    .update(updateData)
    .eq("id", payload.reportId)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[citizen-reporting][PATCH] Update failed:", error.message);
    return NextResponse.json(
      apiError('storage_error', 'Unable to update the report'),
      { status: 503 },
    );
  }

  if (!data) {
    return NextResponse.json(
      apiError('not_found', 'Report not found'),
      { status: 404 },
    );
  }

  return NextResponse.json({ report: data }, { status: 200 });
}
