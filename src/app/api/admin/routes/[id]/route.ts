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
    return NextResponse.json({ error: 'A boolean active field is required' }, { status: 400 });
  }
  const values = body as Record<string, unknown>;
  if (typeof values.active !== 'boolean') {
    return NextResponse.json({ error: 'A boolean active field is required' }, { status: 400 });
  }
  const { data, error } = await authorization.db
    .from('st_routes')
    .update({ active: values.active })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Unable to update route' }, { status: 503 });
  if (!data) return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  try {
    await writeStationAudit(authorization.db, authorization.caller.uid, values.active ? 'route_activated' : 'route_deactivated', 'route', id);
  } catch {
    return NextResponse.json({ error: 'Route updated but audit write failed; investigate before retrying' }, { status: 503 });
  }
  return NextResponse.json({ routeId: id, active: values.active });
}

export async function DELETE(request: Request, context: RouteContext) {
  const authorization = await requireStationUser(request, STATION_ADMIN_ROLES);
  if (!authorization.ok) return authorization.response;
  const { id } = await context.params;
  const { data, error } = await authorization.db
    .from('st_routes')
    .update({ active: false })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Unable to deactivate route' }, { status: 503 });
  if (!data) return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  try {
    await writeStationAudit(authorization.db, authorization.caller.uid, 'route_deactivated', 'route', id);
  } catch {
    return NextResponse.json({ error: 'Route deactivated but audit write failed; investigate before retrying' }, { status: 503 });
  }
  return NextResponse.json({ routeId: id, active: false });
}