// src/app/api/auth/sync/route.ts
//
// Updates:
// 1. Improved role resolution: Prioritizes valid incoming role/userType.
// 2. Conflict protection: Prevents accidental downgrades of admin/staff roles to 'citizen'.
// 3. User Type Mapping: Maps specialized roles to safe 'user_type' values to satisfy DB constraints.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { requireCallerWithEnforce } from "@/lib/auth/verify";
import {
  normalizeRole,
  resolveSelfServiceRole,
  SELF_SERVICE_ROLES,
} from "@/lib/auth/role-policy";

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

type SyncPayload = {
  firebaseUid: string;
  email?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  userType?: string;
  role?: string;
  city?: string;
  language?: string;
};

/**
 * Maps a canonical role to a safe value for the 'user_type' column
 * to satisfy database check constraints.
 */
function getSafeUserType(role: string): string {
  const r = role.toLowerCase();
  // Confirmed safe values: admin, citizen, driver, emergency
  if (r === "admin" || r.includes("_terminal") || r === "tourism" || r === "hotel" || r === "pharmacy" || r === "government_fleet" || r === "church") {
    return "admin";
  }
  if (r === "taxi" || r === "taxi_driver" || r === "driver") {
    return "driver";
  }
  if (r === "emergency" || r === "health") {
    return "emergency";
  }
  return "citizen";
}

function buildDefaultProfile(payload: SyncPayload) {
  const email = payload.email ?? "";
  const resolvedRole = normalizeRole(payload.role || payload.userType);
  const safeUserType = getSafeUserType(resolvedRole);
  
  console.log("[auth/sync][buildDefaultProfile] Resolved role:", resolvedRole, "Safe user_type:", safeUserType);
  
  return {
    id: randomUUID(),
    firebase_uid: payload.firebaseUid,
    email,
    full_name: payload.fullName || email.split("@")[0] || "New User",
    first_name: payload.firstName ?? null,
    last_name: payload.lastName ?? null,
    phone: payload.phone ?? null,
    user_type: safeUserType,
    role: resolvedRole,
    status: "active",
    city: payload.city || "Hawassa",
    language: payload.language || "en",
    is_approved: true,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const firebaseUid = req.nextUrl.searchParams.get("firebaseUid");

  if (!firebaseUid) {
    return NextResponse.json(
      { error: "firebaseUid query parameter is required" },
      { status: 400 }
    );
  }

  // Auth check: caller.uid must equal firebaseUid
  const authResult = await requireCallerWithEnforce(req, {
    uid: firebaseUid,
    route: '/api/auth/sync',
    method: 'GET',
  });

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.status }
    );
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("firebase_uid", firebaseUid)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ user: data }, { status: 200 });
}

export async function POST(req: NextRequest) {
  let payload: SyncPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.firebaseUid) {
    return NextResponse.json(
      { error: "firebaseUid is required" },
      { status: 400 }
    );
  }

  // Auth check: caller.uid must equal firebaseUid
  const authResult = await requireCallerWithEnforce(req, {
    uid: payload.firebaseUid,
    route: '/api/auth/sync',
    method: 'POST',
  });

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.status }
    );
  }

  // When authenticated, the payload email must match the verified token email.
  // This prevents creating or linking an account with someone else's email.
  if (
    authResult.caller?.email &&
    payload.email &&
    authResult.caller.email.toLowerCase() !== payload.email.toLowerCase()
  ) {
    return NextResponse.json(
      { error: "Forbidden: email does not match the authenticated user" },
      { status: 403 }
    );
  }

  const { data: existing, error: lookupError } = await supabase
    .from("users")
    .select("*")
    .eq("firebase_uid", payload.firebaseUid)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }

  if (existing) {
    const existingRole = existing.role || existing.user_type || "citizen";
    const incomingRole = normalizeRole(payload.role || payload.userType);

    // Role protection: a client may only set self-service roles. Admin/staff
    // roles must be provisioned in Supabase, never self-assigned via sync.
    const resolvedRole = resolveSelfServiceRole(incomingRole, existingRole);
    const shouldUpdateRole = resolvedRole !== existingRole;
    
    const updateData: any = {
      last_login: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    
    if (shouldUpdateRole) {
      updateData.role = resolvedRole;
      updateData.user_type = getSafeUserType(resolvedRole);
      console.log("[auth/sync][POST] Updating self-service role from", existingRole, "to", resolvedRole);
    }

    const { data: updated, error: updateError } = await supabase
      .from("users")
      .update(updateData)
      .eq("firebase_uid", payload.firebaseUid)
      .select("*")
      .maybeSingle();

    if (updateError) {
      console.error("[auth/sync][POST] Update error:", updateError.message);
      return NextResponse.json({ user: existing }, { status: 200 });
    }

    return NextResponse.json({ user: updated ?? existing }, { status: 200 });
  }

  // Handle existing record by email but missing firebase_uid
  if (payload.email) {
    const { data: byEmail } = await supabase
      .from("users")
      .select("*")
      .eq("email", payload.email)
      .maybeSingle();

    if (byEmail && !byEmail.firebase_uid) {
      // Only link a pre-provisioned record when the verified token email
      // matches. Otherwise any authenticated user could claim an admin record.
      const callerEmail = authResult.caller?.email?.toLowerCase();
      if (!callerEmail || callerEmail !== payload.email.toLowerCase()) {
        return NextResponse.json(
          { error: "Forbidden: email does not match the authenticated user" },
          { status: 403 }
        );
      }

      const incomingRole = normalizeRole(payload.role || payload.userType);
      const existingRole = byEmail.role || byEmail.user_type || "citizen";
      const finalRole = resolveSelfServiceRole(incomingRole, existingRole);

      const { data: patched, error: patchError } = await supabase
        .from("users")
        .update({
          firebase_uid: payload.firebaseUid,
          role: finalRole,
          user_type: getSafeUserType(finalRole),
          updated_at: new Date().toISOString(),
        })
        .eq("id", byEmail.id)
        .select("*")
        .maybeSingle();

      if (patchError) {
        console.error("[auth/sync][POST] Patch error:", patchError.message);
        return NextResponse.json({ error: patchError.message }, { status: 500 });
      }

      return NextResponse.json({ user: patched }, { status: 200 });
    }
  }

  // New accounts may only self-assign a non-privileged role.
  const requestedRole = normalizeRole(payload.role || payload.userType);
  const assignedRole = SELF_SERVICE_ROLES.has(requestedRole) ? requestedRole : "citizen";
  const newProfile = buildDefaultProfile({ ...payload, role: assignedRole, userType: assignedRole });

  const { data: created, error: insertError } = await supabase
    .from("users")
    .insert(newProfile)
    .select("*")
    .maybeSingle();

  if (insertError) {
    console.error("[auth/sync][POST] Insert error:", insertError.message);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ user: created }, { status: 201 });
}