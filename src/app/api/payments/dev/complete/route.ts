import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/lib/config/env';
import { getPaymentProvider } from '@/lib/station/config';
import {
  PaymentsNotConfiguredError,
  signDevelopmentPaymentEvent,
} from '@/lib/station/payment-provider';
import { processPaymentWebhook } from '@/lib/station/payment-webhook';
import {
  consumeStationRateLimit,
  requireStationUser,
} from '@/lib/station/server';

export async function POST(request: Request) {
  if (env.paymentProvider !== 'dev' || env.appEnv !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const authorization = await requireStationUser(request);
  if (!authorization.ok) return authorization.response;

  const allowed = await consumeStationRateLimit(
    authorization.db,
    authorization.caller.uid,
    'dev-payment-complete',
    5,
    60,
  );
  if (allowed === null) {
    return NextResponse.json({ error: 'Rate limiter unavailable' }, { status: 503 });
  }
  if (!allowed) {
    return NextResponse.json({ error: 'Too many payment attempts' }, { status: 429 });
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
    return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
  }
  const values = body as Record<string, unknown>;
  if (typeof values.ticketId !== 'string') {
    return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
  }

  const { data: ticket, error } = await authorization.db
    .from('st_tickets')
    .select('id, passenger_firebase_uid, fare_etb, status, expires_at')
    .eq('id', values.ticketId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: 'Unable to load the ticket' }, { status: 503 });
  }
  if (!ticket || ticket.passenger_firebase_uid !== authorization.caller.uid) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }
  if (ticket.status !== 'pending_payment') {
    return NextResponse.json(
      { error: 'Ticket is not awaiting payment', status: ticket.status },
      { status: 409 },
    );
  }
  if (new Date(ticket.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Ticket expired' }, { status: 409 });
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
  if (provider.name !== 'dev') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let signed;
  try {
    signed = signDevelopmentPaymentEvent(
      {
        providerRef: `dev:${ticket.id}:${randomUUID()}`,
        ticketId: ticket.id,
        amountEtb: Number(ticket.fare_etb),
        status: 'paid',
      },
      env.paymentWebhookSecret,
    );
  } catch (error) {
    if (error instanceof PaymentsNotConfiguredError) {
      return NextResponse.json({ error: 'Payments not configured' }, { status: 503 });
    }
    throw error;
  }

  const response = await processPaymentWebhook(
    authorization.db,
    provider,
    signed.body,
    signed.signature,
  );
  return NextResponse.json(
    { ...response.body, devPayment: true },
    { status: response.status },
  );
}
