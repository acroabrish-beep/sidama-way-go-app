import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getCaller, type Caller } from '@/lib/auth/verify';
import { apiError } from '@/lib/api/errors';
import { env } from '@/lib/config/env';
import { isOfficialTariff, tariffLabel } from '@/lib/station/domain';

export type StationAuthorization =
  | { ok: true; caller: Caller; role: string; db: SupabaseClient }
  | { ok: false; response: NextResponse };

export const STATION_ADMIN_ROLES = ['admin', 'taxi'] as const;
export const STATION_OPERATOR_ROLES = ['admin', 'taxi', 'taxi_driver'] as const;

let stationDb: SupabaseClient | null = null;

export function getStationServiceClient(): SupabaseClient | null {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  stationDb ??= createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return stationDb;
}

export async function requireStationUser(
  request: Request,
  allowedRoles?: readonly string[],
): Promise<StationAuthorization> {
  const caller = await getCaller(request);
  if (!caller) {
    return {
      ok: false,
      response: NextResponse.json(apiError('unauthorized', 'Unauthorized'), { status: 401 }),
    };
  }

  const db = getStationServiceClient();
  if (!db) {
    return {
      ok: false,
      response: NextResponse.json(
        apiError('storage_error', 'Station service is not configured'),
        { status: 503 },
      ),
    };
  }

  const { data: user, error } = await db
    .from('users')
    .select('role')
    .eq('firebase_uid', caller.uid)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      response: NextResponse.json(
        apiError('storage_error', 'Unable to verify the account role'),
        { status: 503 },
      ),
    };
  }

  if (!user?.role) {
    return {
      ok: false,
      response: NextResponse.json(apiError('forbidden', 'Account role not found'), { status: 403 }),
    };
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return {
      ok: false,
      response: NextResponse.json(apiError('forbidden', 'Forbidden'), { status: 403 }),
    };
  }

  return { ok: true, caller, role: user.role, db };
}

export async function consumeStationRateLimit(
  db: SupabaseClient,
  uid: string,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean | null> {
  const keyHash = createHash('sha256').update(`${action}:${uid}`).digest('hex');
  const { data, error } = await db.rpc('st_consume_rate_limit', {
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) return null;
  return data === true;
}

export { isOfficialTariff, tariffLabel };