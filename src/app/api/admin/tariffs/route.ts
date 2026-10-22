import { NextResponse } from 'next/server';
import { writeStationAudit } from '@/lib/station/audit';
import { requireStationUser, STATION_ADMIN_ROLES } from '@/lib/station/server';

const VEHICLE_TYPES = new Set(['taxi', 'bajaj', 'minibus']);

export async function GET(request: Request) {
  const authorization = await requireStationUser(request, STATION_ADMIN_ROLES);
  if (!authorization.ok) return authorization.response;

  let query = authorization.db
    .from('st_tariffs')
    .select('id, route_id, vehicle_type, fare_etb, effective_from, effective_to, source_reference, approved_by, created_by, created_at')
    .order('effective_from', { ascending: false });
  const routeId = new URL(request.url).searchParams.get('routeId');
  if (routeId) query = query.eq('route_id', routeId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Unable to load tariff history' }, { status: 503 });
  return NextResponse.json({ tariffs: data ?? [] });
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
    return NextResponse.json({ error: 'Invalid tariff payload' }, { status: 400 });
  }
  const values = body as Record<string, unknown>;
  const fareEtb = Number(values.fareEtb);
  if (
    typeof values.routeId !== 'string' ||
    typeof values.vehicleType !== 'string' ||
    !VEHICLE_TYPES.has(values.vehicleType) ||
    !Number.isFinite(fareEtb) ||
    fareEtb <= 0 ||
    typeof values.effectiveFrom !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(values.effectiveFrom) ||
    typeof values.sourceReference !== 'string' ||
    !values.sourceReference.trim()
  ) {
    return NextResponse.json(
      { error: 'routeId, vehicleType, positive fareEtb, effectiveFrom, and sourceReference are required' },
      { status: 400 },
    );
  }

  const { data: tariffId, error } = await authorization.db.rpc('st_create_tariff_version', {
    p_route_id: values.routeId,
    p_vehicle_type: values.vehicleType,
    p_fare_etb: fareEtb,
    p_effective_from: values.effectiveFrom,
    p_source_reference: values.sourceReference.trim(),
    p_approved_by: authorization.caller.uid,
    p_created_by: authorization.caller.uid,
  });
  if (error) {
    return NextResponse.json({ error: 'Unable to create tariff version' }, { status: 409 });
  }

  try {
    await writeStationAudit(
      authorization.db,
      authorization.caller.uid,
      'tariff_created',
      'tariff',
      String(tariffId),
      { routeId: values.routeId, vehicleType: values.vehicleType, effectiveFrom: values.effectiveFrom },
    );
  } catch {
    return NextResponse.json({ error: 'Tariff created but audit write failed; investigate before retrying' }, { status: 503 });
  }

  return NextResponse.json({ tariffId, approvedBy: authorization.caller.uid }, { status: 201 });
}