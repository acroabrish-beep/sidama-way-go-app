import { NextResponse } from 'next/server';
import { writeStationAudit } from '@/lib/station/audit';
import { requireStationUser, STATION_ADMIN_ROLES } from '@/lib/station/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const authorization = await requireStationUser(request, STATION_ADMIN_ROLES);
  if (!authorization.ok) return authorization.response;
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    throw error;
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid station changes' }, { status: 400 });
  }
  const values = body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (typeof values.name === 'string' && values.name.trim()) updates.name = values.name.trim();
  if (typeof values.nameAm === 'string' || values.nameAm === null) updates.name_am = values.nameAm;
  if (typeof values.active === 'boolean') updates.active = values.active;
  if (typeof values.lat === 'number' && Number.isFinite(values.lat) && values.lat >= -90 && values.lat <= 90) updates.lat = values.lat;
  if (typeof values.lng === 'number' && Number.isFinite(values.lng) && values.lng >= -180 && values.lng <= 180) updates.lng = values.lng;
  if (!Object.keys(updates).length) return NextResponse.json({ error: 'No valid station changes supplied' }, { status: 400 });

  const { data, error } = await authorization.db
    .from('st_stations')
    .update(updates)
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Unable to update station' }, { status: 503 });
  if (!data) return NextResponse.json({ error: 'Station not found' }, { status: 404 });
  await writeStationAudit(authorization.db, authorization.caller.uid, 'station_updated', 'station', id, updates);
  return NextResponse.json({ stationId: id });
}

export async function DELETE(request: Request, context: RouteContext) {
  const authorization = await requireStationUser(request, STATION_ADMIN_ROLES);
  if (!authorization.ok) return authorization.response;
  const { id } = await context.params;
  const { data, error } = await authorization.db
    .from('st_stations')
    .update({ active: false })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Unable to deactivate station' }, { status: 503 });
  if (!data) return NextResponse.json({ error: 'Station not found' }, { status: 404 });
  await writeStationAudit(authorization.db, authorization.caller.uid, 'station_deactivated', 'station', id);
  return NextResponse.json({ stationId: id, active: false });
}