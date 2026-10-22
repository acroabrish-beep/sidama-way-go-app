import type { SupabaseClient } from '@supabase/supabase-js';
import { writeStationAudit } from '@/lib/station/audit';
import type { PaymentProvider } from '@/lib/station/payment-provider';

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

export async function processPaymentWebhook(
  db: SupabaseClient,
  provider: PaymentProvider,
  rawBody: string,
  signature: string | null,
): Promise<WebhookResponse> {
  if (!rawBody || Buffer.byteLength(rawBody, 'utf8') > 64 * 1024) {
    return { status: 400, body: { error: 'Invalid webhook body' } };
  }

  const event = provider.verifyWebhook(rawBody, signature);
  if (!event) {
    return { status: 401, body: { error: 'Invalid webhook signature' } };
  }

  let rawCallback: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    rawCallback =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { value: parsed };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { status: 400, body: { error: 'Invalid webhook JSON' } };
    }
    throw error;
  }

  const { data, error } = await db.rpc('st_apply_payment_event', {
    p_ticket_id: event.ticketId,
    p_provider: provider.name,
    p_provider_ref: event.providerRef,
    p_amount_etb: event.amountEtb,
    p_status: event.status,
    p_raw_callback: rawCallback,
  });
  if (error) {
    return { status: 503, body: { error: 'Payment processing unavailable' } };
  }

  try {
    await writeStationAudit(
      db,
      `payment:${provider.name}`,
      `payment_${String(data)}`,
      'ticket',
      event.ticketId,
      {
        providerRef: event.providerRef,
        amountEtb: event.amountEtb,
        status: event.status,
      },
    );
  } catch {
    return { status: 503, body: { error: 'Payment audit write failed' } };
  }

  return { status: 200, body: { result: data } };
}
