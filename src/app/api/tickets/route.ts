import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getPaymentProvider } from '@/lib/station/config';
import { isOfficialTariff, selectActiveTariff } from '@/lib/station/domain';
import {
  PaymentsNotConfiguredError,
  type PaymentSession,
} from '@/lib/station/payment-provider';
import { loadRoutesByIds } from '@/lib/station/route-details';
import {
  consumeStationRateLimit,
  requireStationUser,
} from '@/lib/station/server';
import { generateTicketCode } from '@/lib/station/ticket-code';

const VEHICLE_TYPES = new Set(['taxi', 'bajaj', 'minibus']);
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9:_-]{8,100}$/;

interface PendingTicketResult {
  ticket_id: string;
  payment_id: string;
  provider_ref: string | null;
  idempotency_key: string;
  idempotent_replay: boolean;
}

interface TicketRow {
  id: string;
  code: string;
  route_id: string;
  vehicle_type: string;
  fare_etb: number | string;
  status: string;
  issued_at: string;
  expires_at: string;
  used_at?: string | null;
  verified_vehicle_id?: string | null;
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

function ticketPayload(ticket: TicketRow) {
  return {
    id: ticket.id,
    code: ticket.code,
    route_id: ticket.route_id,
    vehicle_type: ticket.vehicle_type,
    fare_etb: Number(ticket.fare_etb),
    status: effectiveStatus(ticket),
    issued_at: ticket.issued_at,
    expires_at: ticket.expires_at,
  };
}

function paymentPayload(session: PaymentSession | null) {
  if (!session) return null;
  return {
    provider: session.provider,
    providerRef: session.providerRef,
    checkoutUrl: session.checkoutUrl,
    devPayment: session.devPayment,
  };
}

function normalizeIdempotencyKey(value: unknown): string | null {
  if (value === undefined || value === null) return randomUUID();
  if (typeof value !== 'string' || !IDEMPOTENCY_PATTERN.test(value)) return null;
  return value;
}

export async function POST(request: Request) {
  const authorization = await requireStationUser(request);
  if (!authorization.ok) return authorization.response;

  const allowed = await consumeStationRateLimit(
    authorization.db,
    authorization.caller.uid,
    'ticket-create',
    5,
    60,
  );
  if (allowed === null) {
    return NextResponse.json({ error: 'Rate limiter unavailable' }, { status: 503 });
  }
  if (!allowed) {
    return NextResponse.json({ error: 'Too many ticket attempts' }, { status: 429 });
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
      { error: 'routeId and vehicleType are required' },
      { status: 400 },
    );
  }

  const values = body as Record<string, unknown>;
  if (
    typeof values.routeId !== 'string' ||
    typeof values.vehicleType !== 'string' ||
    !VEHICLE_TYPES.has(values.vehicleType)
  ) {
    return NextResponse.json(
      { error: 'routeId and a supported vehicleType are required' },
      { status: 400 },
    );
  }

  const idempotencyKey = normalizeIdempotencyKey(values.idempotencyKey);
  if (!idempotencyKey) {
    return NextResponse.json({ error: 'Invalid idempotencyKey' }, { status: 400 });
  }

  let provider;
  try {
    provider = getPaymentProvider();
  } catch (error) {
    if (error instanceof PaymentsNotConfiguredError) {
      return NextResponse.json({ error: 'Payments not configured' }, { status: 503 });
    }
    throw error;
  }
  if (provider.name === 'disabled') {
    return NextResponse.json({ error: 'Payments not configured' }, { status: 503 });
  }

  const { data: route, error: routeError } = await authorization.db
    .from('st_routes')
    .select('id')
    .eq('id', values.routeId)
    .eq('active', true)
    .maybeSingle();
  if (routeError) {
    return NextResponse.json({ error: 'Unable to load the route' }, { status: 503 });
  }
  if (!route) {
    return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: tariffs, error: tariffsError } = await authorization.db
    .from('st_tariffs')
    .select(
      'id, route_id, vehicle_type, fare_etb, effective_from, effective_to, source_reference, approved_by',
    )
    .eq('route_id', values.routeId)
    .eq('vehicle_type', values.vehicleType)
    .lte('effective_from', today)
    .order('effective_from', { ascending: false });
  if (tariffsError) {
    return NextResponse.json({ error: 'Unable to load the tariff' }, { status: 503 });
  }

  const tariff = selectActiveTariff(tariffs ?? [], today);
  if (!tariff) {
    return NextResponse.json({ error: 'Tariff not set' }, { status: 404 });
  }
  if (!isOfficialTariff(tariff)) {
    return NextResponse.json({ error: 'Tariff pending approval' }, { status: 409 });
  }

  let pending: PendingTicketResult | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateTicketCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { data, error } = await authorization.db.rpc('st_create_pending_ticket', {
      p_code: code,
      p_passenger_uid: authorization.caller.uid,
      p_route_id: values.routeId,
      p_tariff_id: tariff.id,
      p_vehicle_type: values.vehicleType,
      p_fare_etb: Number(tariff.fare_etb),
      p_expires_at: expiresAt,
      p_provider: provider.name,
      p_idempotency_key: idempotencyKey,
    });

    if (!error) {
      pending = data as PendingTicketResult;
      break;
    }
    if (error.code === '23505' && error.message.includes('st_tickets_code_key')) {
      continue;
    }
    if (
      error.code === '23505' &&
      error.message.includes('st_payments_idempotency_key_key')
    ) {
      const { data: replay, error: replayError } = await authorization.db.rpc(
        'st_create_pending_ticket',
        {
          p_code: code,
          p_passenger_uid: authorization.caller.uid,
          p_route_id: values.routeId,
          p_tariff_id: tariff.id,
          p_vehicle_type: values.vehicleType,
          p_fare_etb: Number(tariff.fare_etb),
          p_expires_at: expiresAt,
          p_provider: provider.name,
          p_idempotency_key: idempotencyKey,
        },
      );
      if (!replayError) {
        pending = replay as PendingTicketResult;
        break;
      }
    }
    if (error.message.includes('Idempotency key is not available')) {
      return NextResponse.json(
        { error: 'This payment attempt belongs to another account' },
        { status: 409 },
      );
    }
    if (error.message.includes('Active tariff changed')) {
      return NextResponse.json(
        { error: 'Tariff changed; request a fresh quote' },
        { status: 409 },
      );
    }
    if (error.message.includes('Route is not active')) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Unable to create ticket' }, { status: 409 });
  }

  if (!pending) {
    return NextResponse.json(
      { error: 'Unable to allocate a ticket code' },
      { status: 503 },
    );
  }

  const { data: ticket, error: ticketError } = await authorization.db
    .from('st_tickets')
    .select(
      'id, code, route_id, vehicle_type, fare_etb, status, issued_at, expires_at',
    )
    .eq('id', pending.ticket_id)
    .single();
  if (ticketError || !ticket) {
    return NextResponse.json({ error: 'Unable to load the ticket' }, { status: 503 });
  }

  const row = ticket as TicketRow;
  if (effectiveStatus(row) !== 'pending_payment') {
    return NextResponse.json({
      ticket: ticketPayload(row),
      payment: null,
      replayed: pending.idempotent_replay,
    });
  }

  let session: PaymentSession;
  try {
    session = await provider.createSession({
      ticketId: row.id,
      amountEtb: Number(row.fare_etb),
      idempotencyKey,
    });
  } catch (error) {
    if (error instanceof PaymentsNotConfiguredError) {
      return NextResponse.json({ error: 'Payments not configured' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Unable to start payment' }, { status: 502 });
  }

  return NextResponse.json(
    {
      ticket: ticketPayload(row),
      payment: paymentPayload(session),
      replayed: pending.idempotent_replay,
    },
    { status: pending.idempotent_replay ? 200 : 201 },
  );
}

export async function GET(request: Request) {
  const authorization = await requireStationUser(request);
  if (!authorization.ok) return authorization.response;

  const { data: tickets, error } = await authorization.db
    .from('st_tickets')
    .select(
      'id, code, route_id, vehicle_type, fare_etb, status, issued_at, expires_at, used_at, verified_vehicle_id',
    )
    .eq('passenger_firebase_uid', authorization.caller.uid)
    .order('issued_at', { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: 'Unable to load tickets' }, { status: 503 });
  }

  const rows = (tickets ?? []) as TicketRow[];
  if (!rows.length) return NextResponse.json({ tickets: [] });

  const routeIds = [...new Set(rows.map((ticket) => ticket.route_id))];
  const { data: routeRows, error: routeError } = await authorization.db
    .from('st_routes')
    .select('id, from_station_id, to_station_id')
    .in('id', routeIds);
  if (routeError) {
    return NextResponse.json({ error: 'Unable to load ticket routes' }, { status: 503 });
  }

  let routes;
  try {
    routes = await loadRoutesByIds(authorization.db, routeRows ?? []);
  } catch {
    return NextResponse.json({ error: 'Unable to load ticket routes' }, { status: 503 });
  }

  const { data: payments, error: paymentsError } = await authorization.db
    .from('st_payments')
    .select('ticket_id, provider, provider_ref, amount_etb, status, verified_at, created_at')
    .in(
      'ticket_id',
      rows.map((ticket) => ticket.id),
    )
    .order('created_at', { ascending: false });
  if (paymentsError) {
    return NextResponse.json({ error: 'Unable to load ticket payments' }, { status: 503 });
  }

  const latestPayment = new Map<string, Record<string, unknown>>();
  for (const payment of payments ?? []) {
    if (!latestPayment.has(payment.ticket_id)) {
      latestPayment.set(payment.ticket_id, payment as Record<string, unknown>);
    }
  }

  return NextResponse.json({
    tickets: rows.map((ticket) => ({
      ...ticketPayload(ticket),
      used_at: ticket.used_at ?? null,
      verified_vehicle_id: ticket.verified_vehicle_id ?? null,
      route: routes.get(ticket.route_id) ?? null,
      payment: latestPayment.get(ticket.id) ?? null,
    })),
  });
}
