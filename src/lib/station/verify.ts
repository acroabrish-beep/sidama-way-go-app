import type { SupabaseClient } from '@supabase/supabase-js';
import { writeStationAudit } from '@/lib/station/audit';
import { getQrSigningKeys } from '@/lib/station/config';
import { verifyTicketQr } from '@/lib/station/qr';
import { isTicketCode } from '@/lib/station/ticket-code';

export type TicketVerificationResult =
  | 'valid'
  | 'already_used'
  | 'expired'
  | 'invalid';

export interface TicketVerificationRow {
  id: string;
  code: string;
  route_id: string;
  vehicle_type: string;
  fare_etb: number | string;
  status: string;
  used_at: string | null;
  expires_at: string;
}

export type VerifyOutcome =
  | {
      ok: true;
      result: TicketVerificationResult;
      ticket: TicketVerificationRow | null;
    }
  | { ok: false; status: number; error: string };

const TICKET_COLUMNS =
  'id, code, route_id, vehicle_type, fare_etb, status, used_at, expires_at';

async function verifyTicketId(
  db: SupabaseClient,
  actorUid: string,
  vehicleId: string,
  ticketId: string,
): Promise<VerifyOutcome> {
  const { data, error } = await db.rpc('st_verify_ticket_once', {
    p_ticket_id: ticketId,
    p_actor_uid: actorUid,
    p_vehicle_id: vehicleId,
  });
  if (error) {
    if (error.message.includes('Vehicle is not assigned to this driver')) {
      return {
        ok: false,
        status: 403,
        error: 'Vehicle is not assigned to this driver',
      };
    }
    return { ok: false, status: 503, error: 'Ticket verification is unavailable' };
  }

  const result = data as TicketVerificationResult | null;
  if (
    result !== 'valid' &&
    result !== 'already_used' &&
    result !== 'expired' &&
    result !== 'invalid'
  ) {
    return { ok: false, status: 503, error: 'Verification returned an unknown result' };
  }

  const { data: ticket, error: ticketError } = await db
    .from('st_tickets')
    .select(TICKET_COLUMNS)
    .eq('id', ticketId)
    .maybeSingle();
  if (ticketError) {
    return { ok: false, status: 503, error: 'Unable to load the verified ticket' };
  }

  return {
    ok: true,
    result,
    ticket: (ticket as TicketVerificationRow | null) ?? null,
  };
}

async function auditInvalid(
  db: SupabaseClient,
  actorUid: string,
  action: string,
  entityId: string,
  details: Record<string, unknown>,
): Promise<VerifyOutcome | null> {
  try {
    await writeStationAudit(db, actorUid, action, 'ticket', entityId, details);
  } catch {
    return { ok: false, status: 503, error: 'Verification audit unavailable' };
  }
  return null;
}

export async function verifyTicketByQr(
  db: SupabaseClient,
  actorUid: string,
  vehicleId: string,
  qrToken: string,
): Promise<VerifyOutcome> {
  let keys: Record<string, string>;
  try {
    keys = getQrSigningKeys().keys;
  } catch {
    return { ok: false, status: 503, error: 'Ticket signing is not configured' };
  }

  const verification = verifyTicketQr(qrToken, keys);
  if (!verification.valid) {
    const auditFailure = await auditInvalid(
      db,
      actorUid,
      'ticket_verify_invalid_qr',
      'unknown',
      { reason: verification.reason },
    );
    if (auditFailure) return auditFailure;
    return {
      ok: true,
      result: verification.reason === 'expired' ? 'expired' : 'invalid',
      ticket: null,
    };
  }

  const payload = verification.payload;
  const { data: ticket, error } = await db
    .from('st_tickets')
    .select(TICKET_COLUMNS)
    .eq('id', payload.id)
    .maybeSingle();
  if (error) {
    return { ok: false, status: 503, error: 'Unable to load the ticket' };
  }

  const row = (ticket as TicketVerificationRow | null) ?? null;
  if (
    !row ||
    row.code !== payload.code ||
    row.route_id !== payload.routeId ||
    row.vehicle_type !== payload.vehicleType ||
    Number(row.fare_etb) !== payload.fareEtb
  ) {
    const auditFailure = await auditInvalid(
      db,
      actorUid,
      'ticket_verify_payload_mismatch',
      payload.id,
      {
        qrCode: payload.code,
        ticketCode: row?.code ?? null,
        qrVehicleType: payload.vehicleType,
        ticketVehicleType: row?.vehicle_type ?? null,
        qrFareEtb: payload.fareEtb,
        ticketFareEtb: row ? Number(row.fare_etb) : null,
      },
    );
    if (auditFailure) return auditFailure;
    return { ok: true, result: 'invalid', ticket: null };
  }

  return verifyTicketId(db, actorUid, vehicleId, row.id);
}

export async function verifyTicketByCode(
  db: SupabaseClient,
  actorUid: string,
  vehicleId: string,
  code: string,
): Promise<VerifyOutcome> {
  const normalized = code.trim().toUpperCase();
  if (!isTicketCode(normalized)) {
    const auditFailure = await auditInvalid(
      db,
      actorUid,
      'ticket_verify_invalid_code',
      'unknown',
      { code: normalized },
    );
    if (auditFailure) return auditFailure;
    return { ok: true, result: 'invalid', ticket: null };
  }

  const { data: ticket, error } = await db
    .from('st_tickets')
    .select('id')
    .eq('code', normalized)
    .maybeSingle();
  if (error) {
    return { ok: false, status: 503, error: 'Unable to load the ticket' };
  }
  if (!ticket) {
    const auditFailure = await auditInvalid(
      db,
      actorUid,
      'ticket_verify_invalid_code',
      'unknown',
      { code: normalized },
    );
    if (auditFailure) return auditFailure;
    return { ok: true, result: 'invalid', ticket: null };
  }

  return verifyTicketId(db, actorUid, vehicleId, ticket.id);
}
