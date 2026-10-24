import {
  createClient,
  type SupabaseClient,
} from 'npm:@supabase/supabase-js@2.112.3';
import { HttpError } from './http.ts';
import type { RouteSummary, StationSummary } from './domain.ts';

export type {
  RouteSummary,
  StationSummary,
  TariffRow,
  TicketRow,
} from './domain.ts';
export {
  effectiveStatus,
  isOfficialTariff,
  selectActiveTariff,
  tariffLabel,
  ticketPayload,
} from './domain.ts';

interface RouteRow {
  id: string;
  from_station_id: string;
  to_station_id: string;
}

let serviceClient: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!url || !serviceRoleKey) {
    throw new HttpError(
      503,
      'service_not_configured',
      'Ticket service is unavailable.',
    );
  }

  serviceClient ??= createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function loadRoutesByIds(
  db: SupabaseClient,
  routes: readonly RouteRow[],
): Promise<Map<string, RouteSummary>> {
  const result = new Map<string, RouteSummary>();
  if (!routes.length) return result;

  const stationIds = [
    ...new Set(
      routes.flatMap((route) => [
        route.from_station_id,
        route.to_station_id,
      ]),
    ),
  ];
  const { data: stations, error } = await db
    .from('st_stations')
    .select('id, name, name_am')
    .in('id', stationIds);
  if (error) throw new Error('Unable to load station names');

  const stationsById = new Map(
    ((stations ?? []) as StationSummary[]).map((station) => [
      station.id,
      station,
    ]),
  );
  for (const route of routes) {
    result.set(route.id, {
      id: route.id,
      from: stationsById.get(route.from_station_id) ?? null,
      to: stationsById.get(route.to_station_id) ?? null,
    });
  }
  return result;
}

export async function loadRouteDetails(
  db: SupabaseClient,
  routeId: string,
): Promise<RouteSummary | null> {
  const { data: route, error } = await db
    .from('st_routes')
    .select('id, from_station_id, to_station_id')
    .eq('id', routeId)
    .maybeSingle();
  if (error) throw new Error('Unable to load route');
  if (!route) return null;
  return loadRoutesByIds(db, [route as RouteRow]).then(
    (routes) => routes.get(routeId) ?? null,
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function consumeRateLimit(
  db: SupabaseClient,
  uid: string,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean | null> {
  const keyHash = await sha256Hex(`${action}:${uid}`);
  const { data, error } = await db.rpc('st_consume_rate_limit', {
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error('rate limit unavailable', { code: error.code ?? 'unknown' });
    return null;
  }
  return data === true;
}

export async function writeStationAudit(
  db: SupabaseClient,
  actorUid: string,
  action: string,
  entity: string,
  entityId: string,
  details: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from('st_audit').insert({
    actor_uid: actorUid,
    action,
    entity,
    entity_id: entityId,
    details,
  });
  if (error) throw new Error('Unable to write station audit');
}
