import { NextResponse } from 'next/server';
import { writeStationAudit } from '@/lib/station/audit';
import { requireStationUser, STATION_ADMIN_ROLES } from '@/lib/station/server';

export async function GET(request: Request) {
  const authorization = await requireStationUser(request, STATION_ADMIN_ROLES);
  if (!authorization.ok) return authorization.response;
  const { data, error } = await authorization.db
    .from('st_routes')
    .select('id, from_station_id, to_station_id, active')
    .order('id');
  if (error) return NextResponse.json({ error: 'Unable to load routes' }, { status: 503 });
  return NextResponse.json({ routes: data ?? [] });
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
    return NextResponse.json({ error: 'fromStationId and toStationId are required' }, { status: 400 });
  }
  const values = body as Record<string, unknown>;
  if (typeof values.fromStationId !== 'string' || typeof values.toStationId !== 'string' || values.fromStationId === values.toStationId) {
    return NextResponse.json({ error: 'Distinct fromStationId and toStationId are required' }, { status: 400 });
  }
  const { data, error } = await authorization.db
    .from('st_routes')
    .insert({ from_station_id: values.fromStationId, to_station_id: values.toStationId, active: true })
    .select('id')
    .single();
  if (error?.code === '23505') return NextResponse.json({ error: 'Route already exists' }, { status: 409 });
  if (error) return NextResponse.json({ error: 'Unable to create route' }, { status: 503 });
  await writeStationAudit(authorization.db, authorization.caller.uid, 'route_created', 'route', data.id);
  return NextResponse.json({ routeId: data.id }, { status: 201 });
}