import type { SupabaseClient } from '@supabase/supabase-js';

export interface StationSummary {
  id: string;
  name: string;
  name_am: string | null;
}

export interface RouteSummary {
  id: string;
  from: StationSummary | null;
  to: StationSummary | null;
}

interface RouteRow {
  id: string;
  from_station_id: string;
  to_station_id: string;
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
  return loadRoutesByIds(db, [route]).then((routes) => routes.get(route.id) ?? null);
}

export async function loadRoutesByIds(
  db: SupabaseClient,
  routes: readonly RouteRow[],
): Promise<Map<string, RouteSummary>> {
  const result = new Map<string, RouteSummary>();
  if (!routes.length) return result;

  const stationIds = [
    ...new Set(routes.flatMap((route) => [route.from_station_id, route.to_station_id])),
  ];
  const { data: stations, error } = await db
    .from('st_stations')
    .select('id, name, name_am')
    .in('id', stationIds);
  if (error) throw new Error('Unable to load station names');

  const stationsById = new Map(
    (stations ?? []).map((station) => [station.id, station as StationSummary]),
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
