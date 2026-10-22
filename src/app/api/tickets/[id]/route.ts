import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getQrSigningKeys } from '@/lib/station/config';
import { tariffLabel } from '@/lib/station/domain';
import { signTicketQr } from '@/lib/station/qr';
import { loadRouteDetails } from '@/lib/station/route-details';
import {
  requireStationUser,
  STATION_ADMIN_ROLES,
} from '@/lib/station/server';

type RouteContext = { params: Promise<{ id: string }> };

interface TicketRow {
  id: string;
  code: string;
  passenger_firebase_uid: string;
  route_id: string;
  tariff_id: string;
  vehicle_type: 'taxi' | 'bajaj' | 'minibus';
  fare_etb: number | string;
  status: string;
  issued_at: string;
  expires_at: string;
  used_at: string | null;
  used_by_uid: string | null;
  verified_vehicle_id: string | null;
}

function effectiveStatus(ticket: TicketRow): string {
  if (
    ticket.status === 'pending_payment' &&
    new Date(ticket.expires_at).getTime() <= Date.now()
  ) {
    return 'expired';
  }
  return ticket.status;
}

export async function GET(request: Request, context: RouteContext) {
  const authorization = await requireStationUser(request);
  if (!authorization.ok) return authorization.response;

  const { id } = await context.params;
  const { data: ticket, error } = await authorization.db
    .from('st_tickets')
    .select(
      'id, code, passenger_firebase_uid, route_id, tariff_id, vehicle_type, fare_etb, status, issued_at, expires_at, used_at, used_by_uid, verified_vehicle_id',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: 'Unable to load the ticket' }, { status: 503 });
  }
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  const row = ticket as TicketRow;
  const isOwner = row.passenger_firebase_uid === authorization.caller.uid;
  const isAdmin = (STATION_ADMIN_ROLES as readonly string[]).includes(
    authorization.role,
  );
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [routeResult, tariffResult] = await Promise.allSettled([
    loadRouteDetails(authorization.db, row.route_id),
    authorization.db
      .from('st_tariffs')
      .select('id, route_id, vehicle_type, fare_etb, effective_from, effective_to, source_reference, approved_by, created_by')
      .eq('id', row.tariff_id)
      .maybeSingle(),
  ]);
  if (routeResult.status === 'rejected') {
    return NextResponse.json({ error: 'Unable to load the ticket route' }, { status: 503 });
  }
  const route = routeResult.value;
  if (tariffResult.status === 'rejected' || tariffResult.value.error) {
    return NextResponse.json({ error: 'Unable to load the ticket tariff' }, { status: 503 });
  }
  const tariffRow = tariffResult.value.data;
  const tariff = tariffRow
    ? { ...tariffRow, label: tariffLabel(tariffRow) }
    : null;

  const { data: payment, error: paymentError } = await authorization.db
    .from('st_payments')
    .select('provider, provider_ref, amount_etb, status, verified_at, created_at')
    .eq('ticket_id', row.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentError) {
    return NextResponse.json({ error: 'Unable to load the ticket payment' }, { status: 503 });
  }

  const status = effectiveStatus(row);
  let qrToken: string | null = null;
  let qrError: string | null = null;
  if (status === 'paid' || status === 'used') {
    try {
      const { keys, currentKeyId } = getQrSigningKeys();
      const exp = Math.floor(new Date(row.expires_at).getTime() / 1000);
      qrToken = signTicketQr(
        {
          id: row.id,
          code: row.code,
          routeId: row.route_id,
          vehicleType: row.vehicle_type,
          fareEtb: Number(row.fare_etb),
          exp,
          nonce: randomUUID(),
        },
        currentKeyId,
        keys[currentKeyId],
      );
    } catch {
      qrError = 'Ticket signing is not configured';
    }
  }

  return NextResponse.json({
    ticket: {
      id: row.id,
      code: row.code,
      route_id: row.route_id,
      vehicle_type: row.vehicle_type,
      fare_etb: Number(row.fare_etb),
      status,
      issued_at: row.issued_at,
      expires_at: row.expires_at,
      used_at: row.used_at,
      verified_vehicle_id: row.verified_vehicle_id,
    },
    route,
    tariff,
    payment: payment ?? null,
    qrToken,
    qrError,
  });
}
