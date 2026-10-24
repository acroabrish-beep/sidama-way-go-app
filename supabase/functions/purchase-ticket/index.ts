import {
  authenticateRequest,
} from '../_shared/firebase-auth.ts';
import {
  handleError,
  HttpError,
  jsonResponse,
  preflightResponse,
  readJsonBody,
  requirePost,
} from '../_shared/http.ts';
import { generateTicketCode } from '../_shared/qr.ts';
import {
  consumeRateLimit,
  getServiceClient,
  isOfficialTariff,
  selectActiveTariff,
  ticketPayload,
  todayDate,
  type TariffRow,
  type TicketRow,
} from '../_shared/station.ts';
import { parsePurchaseInput } from '../_shared/validation.ts';

interface PendingTicketResult {
  ticket_id: string;
  payment_id: string;
  provider_ref: string | null;
  idempotency_key: string;
  idempotent_replay: boolean;
}

const readEnv = (key: string): string | undefined => Deno.env.get(key);

function resolvePaymentProvider(): string {
  const provider = readEnv('PAYMENT_PROVIDER')?.trim() || 'disabled';
  const appEnv = readEnv('APP_ENV')?.trim() || '';
  // The Edge Function cannot create a hosted checkout session. Only the
  // development provider, completed by the existing staging webhook, is
  // supported here; real providers still return "Payments not configured".
  if (provider !== 'dev' || appEnv !== 'development') {
    throw new HttpError(
      503,
      'payments_not_configured',
      'Payments not configured',
    );
  }
  return provider;
}

function mapRpcFailure(message: string): HttpError {
  if (message.includes('Idempotency key is not available')) {
    return new HttpError(
      409,
      'idempotency_conflict',
      'This payment attempt belongs to another account',
    );
  }
  if (message.includes('Active tariff changed')) {
    return new HttpError(
      409,
      'tariff_changed',
      'Tariff changed; request a fresh quote',
    );
  }
  if (message.includes('Route is not active')) {
    return new HttpError(404, 'route_not_found', 'Route not found');
  }
  return new HttpError(409, 'ticket_not_created', 'Unable to create ticket');
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return preflightResponse();
  const methodError = requirePost(request);
  if (methodError) return methodError;

  try {
    const { uid } = await authenticateRequest(request, readEnv);
    const db = getServiceClient();

    const allowed = await consumeRateLimit(db, uid, 'ticket-create', 5, 60);
    if (allowed === null) {
      throw new HttpError(
        503,
        'rate_limiter_unavailable',
        'Rate limiter unavailable',
      );
    }
    if (!allowed) {
      throw new HttpError(429, 'rate_limited', 'Too many ticket attempts');
    }

    const input = parsePurchaseInput(await readJsonBody(request));
    const providerName = resolvePaymentProvider();

    const { data: route, error: routeError } = await db
      .from('st_routes')
      .select('id')
      .eq('id', input.routeId)
      .eq('active', true)
      .maybeSingle();
    if (routeError) {
      throw new HttpError(
        503,
        'route_unavailable',
        'Unable to load the route',
      );
    }
    if (!route) {
      throw new HttpError(404, 'route_not_found', 'Route not found');
    }

    const today = todayDate();
    const { data: tariffRows, error: tariffError } = await db
      .from('st_tariffs')
      .select(
        'id, route_id, vehicle_type, fare_etb, effective_from, effective_to, source_reference, approved_by',
      )
      .eq('route_id', input.routeId)
      .eq('vehicle_type', input.vehicleType)
      .lte('effective_from', today)
      .order('effective_from', { ascending: false });
    if (tariffError) {
      throw new HttpError(
        503,
        'tariff_unavailable',
        'Unable to load the tariff',
      );
    }

    const tariff = selectActiveTariff(
      (tariffRows ?? []) as TariffRow[],
      today,
    );
    if (!tariff) {
      throw new HttpError(404, 'tariff_not_set', 'Tariff not set');
    }
    if (!isOfficialTariff(tariff)) {
      throw new HttpError(
        409,
        'tariff_pending',
        'Tariff pending approval',
      );
    }

    let pending: PendingTicketResult | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rpcArgs = {
        p_code: generateTicketCode(),
        p_passenger_uid: uid,
        p_route_id: input.routeId,
        p_tariff_id: tariff.id,
        p_vehicle_type: input.vehicleType,
        p_fare_etb: Number(tariff.fare_etb),
        p_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        p_provider: providerName,
        p_idempotency_key: input.idempotencyKey,
      };

      const { data, error } = await db.rpc(
        'st_create_pending_ticket',
        rpcArgs,
      );
      if (!error) {
        pending = data as PendingTicketResult;
        break;
      }

      const message = error.message ?? '';
      if (error.code === '23505' && message.includes('st_tickets_code_key')) {
        continue;
      }
      if (
        error.code === '23505' &&
        message.includes('st_payments_idempotency_key_key')
      ) {
        const { data: replay, error: replayError } = await db.rpc(
          'st_create_pending_ticket',
          rpcArgs,
        );
        if (!replayError) {
          pending = replay as PendingTicketResult;
          break;
        }
        throw mapRpcFailure(replayError.message ?? '');
      }
      throw mapRpcFailure(message);
    }

    if (!pending) {
      throw new HttpError(
        503,
        'ticket_code_unavailable',
        'Unable to allocate a ticket code',
      );
    }

    const { data: ticket, error: ticketError } = await db
      .from('st_tickets')
      .select(
        'id, code, route_id, vehicle_type, fare_etb, status, issued_at, expires_at, used_at, verified_vehicle_id',
      )
      .eq('id', pending.ticket_id)
      .single();
    if (ticketError || !ticket) {
      throw new HttpError(
        503,
        'ticket_unavailable',
        'Unable to load the ticket',
      );
    }

    const row = ticket as TicketRow;
    const body: Record<string, unknown> = {
      ticket: ticketPayload(row),
      payment: null,
      replayed: pending.idempotent_replay,
    };

    if (ticketPayload(row).status === 'pending_payment') {
      body.payment = {
        provider: providerName,
        provider_ref: null,
        amount_etb: Number(row.fare_etb),
        status: 'pending',
        devPayment: providerName === 'dev',
      };
    }

    return jsonResponse(body, pending.idempotent_replay ? 200 : 201);
  } catch (error) {
    return handleError(
      error,
      'purchase_failed',
      'Unable to create the ticket.',
      'purchase-ticket',
    );
  }
});
