import { NextResponse } from 'next/server';
import { getPaymentProvider } from '@/lib/station/config';
import {
  PaymentsNotConfiguredError,
} from '@/lib/station/payment-provider';
import { processPaymentWebhook } from '@/lib/station/payment-webhook';
import { getStationServiceClient } from '@/lib/station/server';

type RouteContext = { params: Promise<{ provider: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { provider: providerName } = await context.params;

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
  if (providerName !== provider.name) {
    return NextResponse.json({ error: 'Unknown payment provider' }, { status: 404 });
  }

  const db = getStationServiceClient();
  if (!db) {
    return NextResponse.json(
      { error: 'Station service is not configured' },
      { status: 503 },
    );
  }

  const signature = request.headers.get(provider.webhookSignatureHeader);
  const rawBody = await request.text();
  const response = await processPaymentWebhook(db, provider, rawBody, signature);
  return NextResponse.json(response.body, { status: response.status });
}
