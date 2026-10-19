import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/config/env';

// Initialize Firebase Admin with project ID only (no service account needed for ID token verification)
let auth: ReturnType<typeof getAuth> | null = null;

function getFirebaseAuth() {
  if (auth) return auth;

  if (!env.firebaseProjectId) {
    console.warn('[auth] FIREBASE_PROJECT_ID not configured, Firebase auth verification disabled');
    return null;
  }

  try {
    if (getApps().length === 0) {
      initializeApp({
        projectId: env.firebaseProjectId,
      });
    }
    auth = getAuth();
    return auth;
  } catch (error) {
    console.error('[auth] Failed to initialize Firebase Admin:', error);
    return null;
  }
}

// Supabase client for role lookups
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  : null;

const ADMIN_ROLES = [
  'admin',
  'old_terminal',
  'new_terminal',
  'taxi',
  'tourism',
  'hotel',
  'health',
  'pharmacy',
  'emergency',
  'church',
  'government_fleet'
] as const;

export interface Caller {
  uid: string;
  email?: string;
}

export interface AuthResult {
  ok: boolean;
  caller: Caller | null;
  status?: number;
  error?: string;
}

/**
 * Verify Firebase ID token from Authorization header
 * Returns null if header is missing or token is invalid/expired
 * Never throws
 */
export async function getCaller(req: Request): Promise<Caller | null> {
  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth) {
    console.warn('[auth] Firebase auth not initialized');
    return null;
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return null;
  }

  // Extract Bearer token
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) {
    console.warn('[auth] Invalid Authorization header format');
    return null;
  }

  const token = match[1];

  try {
    const decodedToken = await firebaseAuth.verifyIdToken(token);
    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };
  } catch (error) {
    console.warn('[auth] Failed to verify ID token:', error);
    return null;
  }
}

/**
 * Require caller with optional UID check and admin role check
 * Returns { ok, caller, status, error }
 * - ok false + 401 if no valid caller
 * - If uid given, ok false + 403 if caller.uid !== uid
 * - If adminOnly, requires admin role from users table
 */
export async function requireCaller(
  req: Request,
  options: { uid?: string; adminOnly?: boolean } = {}
): Promise<AuthResult> {
  const caller = await getCaller(req);

  if (!caller) {
    return {
      ok: false,
      caller: null,
      status: 401,
      error: 'Unauthorized: No valid Firebase ID token',
    };
  }

  // Check UID match if required
  if (options.uid && caller.uid !== options.uid) {
    return {
      ok: false,
      caller,
      status: 403,
      error: 'Forbidden: UID mismatch',
    };
  }

  // Check admin role if required
  if (options.adminOnly) {
    if (!supabase) {
      console.error('[auth] Supabase not configured for role check');
      return {
        ok: false,
        caller,
        status: 500,
        error: 'Server configuration error',
      };
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('role')
      .eq('firebase_uid', caller.uid)
      .maybeSingle();

    if (error || !user) {
      return {
        ok: false,
        caller,
        status: 403,
        error: 'Forbidden: User not found or role check failed',
      };
    }

    if (!ADMIN_ROLES.includes(user.role as any)) {
      return {
        ok: false,
        caller,
        status: 403,
        error: 'Forbidden: Admin access required',
      };
    }
  }

  return {
    ok: true,
    caller,
  };
}

/**
 * Wrapper for requireCaller that respects AUTH_ENFORCE env var
 * When AUTH_ENFORCE=false, logs warnings instead of blocking
 */
export async function requireCallerWithEnforce(
  req: Request,
  options: { uid?: string; adminOnly?: boolean; route: string; method: string }
): Promise<AuthResult> {
  const enforce = process.env.AUTH_ENFORCE === 'true';
  const result = await requireCaller(req, options);

  if (!result.ok && !enforce) {
    console.warn(`[auth] unverified call to ${options.route} ${options.method} - would return ${result.status}: ${result.error}`);
    // Return ok=true with null caller to allow request to proceed in log-only mode
    return {
      ok: true,
      caller: null,
    };
  }

  return result;
}
