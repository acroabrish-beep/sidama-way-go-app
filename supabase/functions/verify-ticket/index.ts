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
import {
  isTicketCode,
  loadSigningKeys,
  verifyTicketQr,
} from '../_shared/qr.ts';
import {
  consumeRateLimit,
  getServiceClient,
  loadRouteDetails,
  ticketPayload,
  writeStationAudit,
  type TicketRow,
} from '../_shared/station.ts';
import { parseVerifyInput, type VerifyInput } from '../_shared/validation.ts';

type TicketVerificationResult = 'valid' | 'already_used' | 'expired' | 'invalid';

const readEnv = (key: string): string | undefined => Deno.env.get(key);

const TICKET_COLUMNS =
  'id, code, route_id, vehicle_type, fare_etb, status, issued_at, expires_at, used_at, verified_vehicle_id';

function outcome(
  result: TicketVerificationResult,
  ticket: TicketRow | null,
  route: Record<string, unknown> | null = null,
  routeError: string | null = null,
): Response {
  return jsonResponse({
    result,
    ticket: ticket ? ticketPayload(ticket) : null,
    route,
    routeError,
  });
}

async function auditInvalid(
  db: ReturnType<typeof getServiceClient>,
  uid: string,
  action: string,
  entityId: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await writeStationAudit(db, uid, action, 'ticket', entityId, details);
  } catch {
    throw new HttpError(
      503,
      'audit_unavailable',
      'Verification audit unavailable',
    );
  }
}

async function verifyByQr(
  db: ReturnType<typeof getServiceClient>,
  uid: string,
  vehicleId: string,
  qrToken: string,
): Promise<Response> {
  let keys: Record<string, string>;
  try {
    keys = loadSigningKeys(readEnv).keys;
  } catch {
    throw new HttpError(
      503,
      'qr_not_configured',
      'Ticket signing is not configured',
    );
  }

  const verification = await verifyTicketQr(qrToken, keys);
  if (!verification.valid) {
    await auditInvalid(db, uid, 'ticket_verify_invalid_qr', 'unknown', {
      reason: verification.reason,
    });
    return outcome(
      verification.reason === 'expired' ? 'expired' : 'invalid',
      null,
    );
  }

  const payload = verification.payload;
  const { data, error } = await db
    .from('st_tickets')
    .select(TICKET_COLUMNS)
    .eq('id', payload.id)
    .maybeSingle();
  if (error) {
    throw new HttpError(
      503,
      'ticket_unavailable',
      'Unable to load the ticket',
    );
  }

  const row = (data as TicketRow | null) ?? null;
  if (
    !row ||
    row.code !== payload.code ||
    row.route_id !== payload.routeId ||
    row.vehicle_type !== payload.vehicleType ||
    Number(row.fare_etb) !== payload.fareEtb
  ) {
    await auditInvalid(db, uid, 'ticket_verify_payload_mismatch', payload.id, {
      qrCode: payload.code,
      ticketCode: row?.code ?? null,
      qrVehicleType: payload.vehicleType,
      ticketVehicleType: row?.vehicle_type ?? null,
      qrFareEtb: payload.fareEtb,
      ticketFareEtb: row ? Number(row.fare_etb) : null,
    });
    return outcome('invalid', null);
  }

  return verifyTicketId(db, uid, vehicleId, row.id);
}

async function verifyByCode(
  db: ReturnType<typeof getServiceClient>,
  uid: string,
  vehicleId: string,
  code: string,
): Promise<Response> {
  const normalized = code.trim().toUpperCase();
  if (!isTicketCode(normalized)) {
    await auditInvalid(db, uid, 'ticket_verify_invalid_code', 'unknown', {
      code: normalized,
    });
    return outcome('invalid', null);
  }

  const { data, error } = await db
    .from('st_tickets')
    .select('id')
    .eq('code', normalized)
    .maybeSingle();
  if (error) {
    throw new HttpError(
      503,
      'ticket_unavailable',
      'Unable to load the ticket',
    );
  }
  if (!data) {
    await auditInvalid(db, uid, 'ticket_verify_invalid_code', 'unknown', {
      code: normalized,
    });
    return outcome('invalid', null);
  }

  return verifyTicketId(db, uid, vehicleId, (data as { id: string }).id);
}

async function verifyTicketId(
  db: ReturnType<typeof getServiceClient>,
  uid: string,
  vehicleId: string,
  ticketId: string,
): Promise<Response> {
  const { data, error } = await db.rpc('st_verify_ticket_once', {
    p_ticket_id: ticketId,
    p_actor_uid: uid,
    p_vehicle_id: vehicleId,
  });
  if (error) {
    if ((error.message ?? '').includes('Vehicle is not assigned to this driver')) {
      throw new HttpError(
        403,
        'vehicle_not_assigned',
        'Vehicle is not assigned to this driver',
      );
    }
    throw new HttpError(
      503,
      'verification_unavailable',
      'Ticket verification is unavailable',
    );
  }

  const result = data as TicketVerificationResult | null;
  if (
    result !== 'valid' &&
    result !== 'already_used' &&
    result !== 'expired' &&
    result !== 'invalid'
  ) {
    throw new HttpError(
      503,
      'verification_unavailable',
      'Verification returned an unknown result',
    );
  }

  const { data: ticket, error: ticketError } = await db
    .from('st_tickets')
    .select(TICKET_COLUMNS)
    .eq('id', ticketId)
    .maybeSingle();
  if (ticketError) {
    throw new HttpError(
      503,
      'ticket_unavailable',
      'Unable to load the verified ticket',
    );
  }

  const row = (ticket as TicketRow | null) ?? null;
  if (!row) return outcome(result, null);

  let route: Record<string, unknown> | null = null;
  let routeError: string | null = null;
  try {
    route = (await loadRouteDetails(db, row.route_id)) as Record<
      string,
      unknown
    > | null;
  } catch {
    routeError = 'Unable to load route details';
  }

  return outcome(result, row, route, routeError);
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return preflightResponse();
  const methodError = requirePost(request);
  if (methodError) return methodError;

  try {
    const { uid } = await authenticateRequest(request, readEnv);
    const db = getServiceClient();

    const allowed = await consumeRateLimit(db, uid, 'ticket-verify', 30, 60);
    if (allowed === null) {
      throw new HttpError(
        503,
        'rate_limiter_unavailable',
        'Rate limiter unavailable',
      );
    }
    if (!allowed) {
      throw new HttpError(
        429,
        'rate_limited',
        'Too many verification attempts',
      );
    }

    const input: VerifyInput = parseVerifyInput(await readJsonBody(request));
    if (input.qrToken) {
      return await verifyByQr(db, uid, input.vehicleId, input.qrToken);
    }
    return await verifyByCode(db, uid, input.vehicleId, input.code ?? '');
  } catch (error) {
    return handleError(
      error,
      'verification_failed',
      'Unable to verify the ticket.',
      'verify-ticket',
    );
  }
});
