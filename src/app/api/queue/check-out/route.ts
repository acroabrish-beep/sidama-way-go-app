import { NextResponse } from 'next/server';
import {
  consumeStationRateLimit,
  requireStationUser,
  STATION_OPERATOR_ROLES,
} from '@/lib/station/server';

export async function POST(request: Request) {
  const authorization = await requireStationUser(request, STATION_OPERATOR_ROLES);
  if (!authorization.ok) return authorization.response;

  const allowed = await consumeStationRateLimit(
    authorization.db,
    authorization.caller.uid,
    'queue-check-out',
    5,
    60,
  );
  if (allowed === null) {
    return NextResponse.json({ error: 'Rate limiter unavailable' }, { status: 503 });
  }
  if (!allowed) return NextResponse.json({ error: 'Too many check-out attempts' }, { status: 429 });

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
    return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
  }
  const values = body as Record<string, unknown>;
  if (typeof values.vehicleId !== 'string') {
    return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
  }

  const { data: checkedOut, error } = await authorization.db.rpc('st_queue_check_out', {
    p_vehicle_id: values.vehicleId,
    p_actor_uid: authorization.caller.uid,
  });
  if (error) return NextResponse.json({ error: 'Unable to check out vehicle' }, { status: 403 });
  return NextResponse.json({ checkedOut });
}