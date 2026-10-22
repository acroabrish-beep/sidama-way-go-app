import { NextResponse } from 'next/server';
import { loadRouteDetails } from '@/lib/station/route-details';
import {
  consumeStationRateLimit,
  requireStationUser,
  STATION_OPERATOR_ROLES,
} from '@/lib/station/server';
import { verifyTicketByCode } from '@/lib/station/verify';

export async function POST(request: Request) {
  const authorization = await requireStationUser(request, STATION_OPERATOR_ROLES);
  if (!authorization.ok) return authorization.response;

  const allowed = await consumeStationRateLimit(
    authorization.db,
    authorization.caller.uid,
    'ticket-verify-code',
    30,
    60,
  );
  if (allowed === null) {
    return NextResponse.json({ error: 'Rate limiter unavailable' }, { status: 503 });
  }
  if (!allowed) {
    return NextResponse.json({ error: 'Too many verification attempts' }, { status: 429 });
  }

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
    return NextResponse.json(
      { error: 'code and vehicleId are required' },
      { status: 400 },
    );
  }

  const values = body as Record<string, unknown>;
  if (
    typeof values.code !== 'string' ||
    !values.code.trim() ||
    typeof values.vehicleId !== 'string'
  ) {
    return NextResponse.json(
      { error: 'code and vehicleId are required' },
      { status: 400 },
    );
  }

  const outcome = await verifyTicketByCode(
    authorization.db,
    authorization.caller.uid,
    values.vehicleId,
    values.code,
  );
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  let route = null;
  let routeError: string | null = null;
  if (outcome.ticket) {
    try {
      route = await loadRouteDetails(authorization.db, outcome.ticket.route_id);
    } catch {
      routeError = 'Unable to load route details';
    }
  }

  return NextResponse.json({
    result: outcome.result,
    ticket: outcome.ticket,
    route,
    routeError,
  });
}
