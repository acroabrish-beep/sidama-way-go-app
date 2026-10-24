import { authenticateRequest } from '../_shared/firebase-auth.ts';
import {
  handleError,
  HttpError,
  jsonResponse,
  preflightResponse,
  readJsonBody,
  requirePost,
} from '../_shared/http.ts';
import { loadSigningKeys, signTicketQr } from '../_shared/qr.ts';
import {
  effectiveStatus,
  getServiceClient,
  loadRouteDetails,
  tariffLabel,
  ticketPayload,
  type TariffRow,
  type TicketRow,
} from '../_shared/station.ts';
import { parseTicketId } from '../_shared/validation.ts';

const readEnv = (key: string): string | undefined => Deno.env.get(key);

const TICKET_COLUMNS =
  'id, code, passenger_firebase_uid, route_id, tariff_id, vehicle_type, fare_etb, status, issued_at, expires_at, used_at, verified_vehicle_id';

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return preflightResponse();
  const methodError = requirePost(request);
  if (methodError) return methodError;

  try {
    const { uid } = await authenticateRequest(request, readEnv);
    const db = getServiceClient();
    const ticketId = parseTicketId(await readJsonBody(request));

    const { data, error } = await db
      .from('st_tickets')
      .select(TICKET_COLUMNS)
      .eq('id', ticketId)
      .maybeSingle();
    if (error) {
      throw new HttpError(
        503,
        'ticket_unavailable',
        'Unable to load the ticket',
      );
    }

    const row = (data as TicketRow | null) ?? null;
    // Hide other passengers' tickets behind the same 404 as a missing ticket.
    if (!row || row.passenger_firebase_uid !== uid) {
      throw new HttpError(404, 'ticket_not_found', 'Ticket not found');
    }

    let route: Record<string, unknown> | null = null;
    try {
      route = (await loadRouteDetails(db, row.route_id)) as Record<
        string,
        unknown
      > | null;
    } catch {
      throw new HttpError(
        503,
        'route_unavailable',
        'Unable to load the ticket route',
      );
    }

    const { data: tariffRow, error: tariffError } = await db
      .from('st_tariffs')
      .select(
        'id, route_id, vehicle_type, fare_etb, effective_from, effective_to, source_reference, approved_by, created_by',
      )
      .eq('id', row.tariff_id)
      .maybeSingle();
    if (tariffError) {
      throw new HttpError(
        503,
        'tariff_unavailable',
        'Unable to load the ticket tariff',
      );
    }
    const tariff = tariffRow
      ? { ...(tariffRow as TariffRow), label: tariffLabel(tariffRow as TariffRow) }
      : null;

    const { data: payment, error: paymentError } = await db
      .from('st_payments')
      .select(
        'provider, provider_ref, amount_etb, status, verified_at, created_at',
      )
      .eq('ticket_id', row.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (paymentError) {
      throw new HttpError(
        503,
        'payment_unavailable',
        'Unable to load the ticket payment',
      );
    }

    const status = effectiveStatus(row);
    let qrToken: string | null = null;
    let qrError: string | null = null;
    if (status === 'paid' || status === 'used') {
      try {
        const { keys, currentKeyId } = loadSigningKeys(readEnv);
        qrToken = await signTicketQr(
          {
            id: row.id,
            code: row.code,
            routeId: row.route_id,
            vehicleType: row.vehicle_type as
              | 'taxi'
              | 'bajaj'
              | 'minibus',
            fareEtb: Number(row.fare_etb),
            exp: Math.floor(new Date(row.expires_at).getTime() / 1000),
            nonce: crypto.randomUUID(),
          },
          currentKeyId,
          keys[currentKeyId],
        );
      } catch {
        qrError = 'Ticket signing is not configured';
      }
    }

    return jsonResponse({
      ticket: ticketPayload(row),
      route,
      tariff,
      payment: payment ?? null,
      qrToken,
      qrError,
    });
  } catch (error) {
    return handleError(
      error,
      'ticket_unavailable',
      'Unable to load the ticket.',
      'ticket-qr',
    );
  }
});
