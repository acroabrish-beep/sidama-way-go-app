import { NextResponse } from 'next/server';
import {
  consumeStationRateLimit,
  requireStationUser,
  STATION_OPERATOR_ROLES,
} from '@/lib/station/server';

const VEHICLE_TYPES = new Set(['taxi', 'bajaj', 'minibus']);

export async function POST(request: Request) {
  const authorization = await requireStationUser(request, STATION_OPERATOR_ROLES);
  if (!authorization.ok) return authorization.response;

  const allowed = await consumeStationRateLimit(
    authorization.db,
    authorization.caller.uid,
    'queue-check-in',
    5,
    60,
  );
  if (allowed === null) {
    return NextResponse.json({ error: 'Rate limiter unavailable' }, { status: 503 });
  }
  if (!allowed) return NextResponse.json({ error: 'Too many check-in attempts' }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    throw error;
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'stationId and vehicleId are required' }, { status: 400 });
  }

  const values = body as Record<string, unknown>;
  if (typeof values.stationId !== 'string' || typeof values.vehicleId !== 'string') {
    return NextResponse.json({ error: 'stationId and vehicleId are required' }, { status: 400 });
  }

  const { data: vehicle, error: vehicleError } = await authorization.db
    .from('vehicles')
    .select('vehicle_type')
    .eq('id', values.vehicleId)
    .maybeSingle();
  if (vehicleError) {
    return NextResponse.json({ error: 'Unable to verify vehicle' }, { status: 503 });
  }
  if (!vehicle) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
  if (!VEHICLE_TYPES.has(vehicle.vehicle_type)) {
    return NextResponse.json({ error: 'Vehicle type is not supported for station queues' }, { status: 400 });
  }

  const { data: queueId, error } = await authorization.db.rpc('st_queue_check_in', {
    p_station_id: values.stationId,
    p_vehicle_id: values.vehicleId,
    p_vehicle_type: vehicle.vehicle_type,
    p_actor_uid: authorization.caller.uid,
  });
  if (error?.code === '23505') {
    return NextResponse.json({ error: 'Vehicle already has an active queue entry' }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: 'Unable to check in vehicle' }, { status: 403 });

  return NextResponse.json({ queueId }, { status: 201 });
}