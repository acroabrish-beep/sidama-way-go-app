import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createVerify, X509Certificate } from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;

if (!supabaseUrl || !serviceRoleKey || !firebaseProjectId) {
  throw new Error("Missing required server configuration: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FIREBASE_PROJECT_ID");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type FirebaseClaims = {
  sub: string;
  user_id?: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  auth_time: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

let cachedCerts: { expiresAt: number; certs: Record<string, string> } | null = null;

async function getFirebaseCerts(): Promise<Record<string, string>> {
  if (cachedCerts && cachedCerts.expiresAt > Date.now()) return cachedCerts.certs;
  const response = await fetch("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com", { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to retrieve Firebase signing certificates");
  const certs = await response.json() as Record<string, string>;
  const cacheControl = response.headers.get("cache-control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 3600);
  cachedCerts = { certs, expiresAt: Date.now() + Math.min(maxAge, 3600) * 1000 };
  return certs;
}

async function verifyFirebaseToken(request: NextRequest): Promise<FirebaseClaims | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const headerJson = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (headerJson.alg !== "RS256" || typeof headerJson.kid !== "string") return null;
    const certs = await getFirebaseCerts();
    const cert = certs[headerJson.kid];
    if (!cert) return null;

    const verifier = createVerify("RSA-SHA256");
    verifier.update(parts[0] + "." + parts[1]);
    verifier.end();
    if (!verifier.verify(new X509Certificate(cert).publicKey, Buffer.from(parts[2], "base64url"))) return null;

    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as FirebaseClaims;
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.aud !== firebaseProjectId ||
      claims.iss !== `https://securetoken.google.com/${firebaseProjectId}` ||
      !claims.sub ||
      claims.sub.length > 128 ||
      !claims.exp || claims.exp <= now ||
      !claims.iat || claims.iat > now + 60 ||
      !claims.auth_time || claims.auth_time > now + 60
    ) return null;

    return claims;
  } catch {
    return null;
  }
}

type SyncPayload = {
  email?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  city?: string;
  language?: string;
};

function jsonUnauthorized() {
  return NextResponse.json({ error: "Valid Firebase ID token required" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const claims = await verifyFirebaseToken(req);
  if (!claims) return jsonUnauthorized();

  const { data, error } = await supabase
    .from("users").select("*").eq("firebase_uid", claims.sub).maybeSingle();

  if (error) return NextResponse.json({ error: "Unable to load user profile" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ user: data });
}

export async function POST(req: NextRequest) {
  const claims = await verifyFirebaseToken(req);
  if (!claims) return jsonUnauthorized();

  let payload: SyncPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Identity and email come from the verified token, never from client-supplied IDs.
  const firebaseUid = claims.sub;
  const email = claims.email || "";
  const fullName = (typeof payload.fullName === "string" && payload.fullName.trim().slice(0, 120)) ||
    claims.name || email.split("@")[0] || "New User";

  const { data: existing, error: lookupError } = await supabase
    .from("users").select("*").eq("firebase_uid", firebaseUid).maybeSingle();

  if (lookupError) return NextResponse.json({ error: "Unable to load user profile" }, { status: 500 });

  if (existing) {
    const updateData: Record<string, unknown> = {
      last_login: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (email) updateData.email = email;
    if (typeof payload.phone === "string") updateData.phone = payload.phone.slice(0, 30);
    if (typeof payload.city === "string") updateData.city = payload.city.slice(0, 100);
    if (typeof payload.language === "string") updateData.language = payload.language.slice(0, 10);
    const { data: updated, error } = await supabase.from("users")
      .update(updateData).eq("firebase_uid", firebaseUid).select("*").maybeSingle();
    if (error) return NextResponse.json({ error: "Unable to update user profile" }, { status: 500 });
    return NextResponse.json({ user: updated ?? existing });
  }

  // Link a legacy profile by email only when Firebase confirms that email.
  if (email && claims.email_verified === true) {
    const { data: byEmail, error: emailLookupError } = await supabase
      .from("users").select("*").eq("email", email).maybeSingle();
    if (emailLookupError) return NextResponse.json({ error: "Unable to find existing profile" }, { status: 500 });

    if (byEmail && !byEmail.firebase_uid) {
      const { data: patched, error } = await supabase.from("users")
        .update({ firebase_uid: firebaseUid, updated_at: new Date().toISOString() })
        .eq("id", byEmail.id).is("firebase_uid", null).select("*").maybeSingle();
      if (error) return NextResponse.json({ error: "Unable to link existing profile" }, { status: 500 });
      if (patched) return NextResponse.json({ user: patched });
    }
  }

  const newProfile = {
    firebase_uid: firebaseUid,
    email,
    full_name: fullName,
    first_name: typeof payload.firstName === "string" ? payload.firstName.slice(0, 80) : null,
    last_name: typeof payload.lastName === "string" ? payload.lastName.slice(0, 80) : null,
    phone: typeof payload.phone === "string" ? payload.phone.slice(0, 30) : null,
    user_type: "citizen",
    role: "citizen",
    status: "active",
    city: typeof payload.city === "string" ? payload.city.slice(0, 100) : "Hawassa",
    language: typeof payload.language === "string" ? payload.language.slice(0, 10) : "en",
    is_approved: false,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  const { data: created, error: insertError } = await supabase
    .from("users").insert(newProfile).select("*").maybeSingle();

  if (insertError) return NextResponse.json({ error: "Unable to create user profile" }, { status: 500 });
  return NextResponse.json({ user: created }, { status: 201 });
}
