import { NextResponse } from 'next/server';
import { requireStationUser } from '@/lib/station/server';
import { selectActiveTariff, tariffLabel } from '@/lib/station/domain';

const VEHICLE_TYPES = new Set(['taxi', 'bajaj', 'minibus']);

export async function GET(request: Request) {
  const authorization = await requireStationUser(request);
  if (!authorization.ok) return authorization.response;

  const url = new URL(request.url);
  const routeId = url.searchParams.get('routeId');
  const vehicleType = url.searchParams.get('vehicleType');
  if (!routeId || !vehicleType || !VEHICLE_TYPES.has(vehicleType)) {
    return NextResponse.json({ error: 'routeId and a valid vehicleType are required' }, { status: 400 });
  }

  const { data: route, error: routeError } = await authorization.db
    .from('st_routes')
    .select('id')
    .eq('id', routeId)
    .eq('active', true)
    .maybeSingle();

  if (routeError) {
    return NextResponse.json({ error: 'Unable to load tariff' }, { status: 503 });
  }
  if (!route) return NextResponse.json({ error: 'Route not found' }, { status: 404 });

  const today = new Date().toISOString().slice(0, 10);
  const { data: tariffs, error } = await authorization.db
    .from('st_tariffs')
    .select('id, route_id, vehicle_type, fare_etb, effective_from, effective_to, source_reference, approved_by')
    .eq('route_id', routeId)
    .eq('vehicle_type', vehicleType)
    .lte('effective_from', today)
    .order('effective_from', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Unable to load tariff' }, { status: 503 });
  }

  const tariff = selectActiveTariff(tariffs ?? [], today);
  if (!tariff) {
    return NextResponse.json({ error: 'Tariff not set' }, { status: 404 });
  }

  return NextResponse.json({
    tariff: { ...tariff, label: tariffLabel(tariff) },
  });
}