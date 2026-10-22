import { NextResponse } from 'next/server';
import { requireStationUser } from '@/lib/station/server';
import { selectActiveTariff, tariffLabel } from '@/lib/station/domain';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authorization = await requireStationUser(request);
  if (!authorization.ok) return authorization.response;

  const { id: stationId } = await context.params;
  const { data: routes, error: routesError } = await authorization.db
    .from('st_routes')
    .select('id, from_station_id, to_station_id')
    .eq('from_station_id', stationId)
    .eq('active', true);

  if (routesError) {
    return NextResponse.json({ error: 'Unable to load destinations' }, { status: 503 });
  }

  if (!routes?.length) return NextResponse.json({ destinations: [] });

  const destinationIds = [...new Set(routes.map((route) => route.to_station_id))];
  const routeIds = routes.map((route) => route.id);
  const today = new Date().toISOString().slice(0, 10);
  const [stationsResult, tariffsResult, queueResult] = await Promise.all([
    authorization.db
      .from('st_stations')
      .select('id, name, name_am')
      .in('id', destinationIds)
      .eq('active', true),
    authorization.db
      .from('st_tariffs')
      .select('id, route_id, vehicle_type, fare_etb, effective_from, effective_to, source_reference, approved_by')
      .in('route_id', routeIds)
      .lte('effective_from', today),
    authorization.db
      .from('st_queue')
      .select('station_id, vehicle_type')
      .eq('station_id', stationId)
      .eq('status', 'waiting'),
  ]);

  if (stationsResult.error || tariffsResult.error || queueResult.error) {
    return NextResponse.json({ error: 'Unable to load station availability' }, { status: 503 });
  }

  const stationsById = new Map((stationsResult.data ?? []).map((station) => [station.id, station]));
  const activeTariffs = (tariffsResult.data ?? []).filter((tariff) =>
    selectActiveTariff([tariff], today),
  );
  const queues = new Map<string, number>();
  for (const entry of queueResult.data ?? []) {
    const key = entry.vehicle_type;
    queues.set(key, (queues.get(key) ?? 0) + 1);
  }

  const destinations = routes.flatMap((route) => {
    const station = stationsById.get(route.to_station_id);
    if (!station) return [];
    const tariffs = activeTariffs
      .filter((tariff) => tariff.route_id === route.id)
      .map((tariff) => ({ ...tariff, label: tariffLabel(tariff) }));
    return [{ route_id: route.id, station, tariffs, queue_counts: Object.fromEntries(queues) }];
  });

  return NextResponse.json({ destinations });
}