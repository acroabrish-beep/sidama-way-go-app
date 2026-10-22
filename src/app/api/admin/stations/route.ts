import { NextResponse } from 'next/server';
import { writeStationAudit } from '@/lib/station/audit';
import { requireStationUser, STATION_ADMIN_ROLES } from '@/lib/station/server';

export async function GET(request: Request) {
  const authorization = await requireStationUser(request, STATION_ADMIN_ROLES);
  if (!authorization.ok) return authorization.response;
  const { data, error } = await authorization.db
    .from('st_stations')
    .select('id, name, name_am, lat, lng, active')
    .order('name');
  if (error) return NextResponse.json({ error: 'Unable to load stations' }, { status: 503 });
  return NextResponse.json({ stations: data ?? [] });
}

export async function POST(request: Request) {
  const authorization = await requireStationUser(request, STATION_ADMIN_ROLES);
  if (!authorization.ok) return authorization.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    throw error;
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'A station name is required' }, { status: 400 });
  }
  const values = body as Record<string, unknown>;
  if (typeof values.name !== 'string' || !values.name.trim()) {
    return NextResponse.json({ error: 'A station name is required' }, { status: 400 });
  }
  if (
    (values.lat !== undefined && (typeof values.lat !== 'number' || !Number.isFinite(values.lat) || values.lat < -90 || values.lat > 90)) ||
    (values.lng !== undefined && (typeof values.lng !== 'number' || !Number.isFinite(values.lng) || values.lng < -180 || values.lng > 180)) ||
    (values.nameAm !== undefined && typeof values.nameAm !== 'string')
  ) {
    return NextResponse.json({ error: 'Invalid station location or local name' }, { status: 400 });
  }
  const { data, error } = await authorization.db
    .from('st_stations')
    .insert({
      name: values.name.trim(),
      name_am: values.nameAm ?? null,
      lat: values.lat ?? null,
      lng: values.lng ?? null,
      active: true,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: 'Unable to create station' }, { status: 503 });
  await writeStationAudit(authorization.db, authorization.caller.uid, 'station_created', 'station', data.id);
  return NextResponse.json({ stationId: data.id }, { status: 201 });
}