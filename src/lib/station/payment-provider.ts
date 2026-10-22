import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PaymentSessionInput {
  ticketId: string;
  amountEtb: number;
  idempotencyKey: string;
}

export interface PaymentSession {
  provider: string;
  providerRef: string;
  checkoutUrl: string | null;
  devPayment: boolean;
}

export interface VerifiedPaymentEvent {
  providerRef: string;
  ticketId: string;
  amountEtb: number;
  status: 'paid' | 'failed';
}

export interface PaymentProvider {
  readonly name: string;
  readonly webhookSignatureHeader: string;
  createSession(input: PaymentSessionInput): Promise<PaymentSession>;
  verifyWebhook(rawBody: string, signature: string | null): VerifiedPaymentEvent | null;
}

export class PaymentsNotConfiguredError extends Error {
  constructor() {
    super('Payments not configured');
    this.name = 'PaymentsNotConfiguredError';
  }
}

class DisabledPaymentProvider implements PaymentProvider {
  readonly name = 'disabled';
  readonly webhookSignatureHeader = 'x-payment-signature';

  async createSession(): Promise<PaymentSession> {
    throw new PaymentsNotConfiguredError();
  }

  verifyWebhook(): VerifiedPaymentEvent | null {
    return null;
  }
}

class DevelopmentPaymentProvider implements PaymentProvider {
  readonly name = 'dev';
  readonly webhookSignatureHeader = 'x-payment-signature';
  private readonly webhookSecret: string;

  constructor(webhookSecret: string) {
    if (!webhookSecret) throw new PaymentsNotConfiguredError();
    this.webhookSecret = webhookSecret;
  }

  async createSession(input: PaymentSessionInput): Promise<PaymentSession> {
    return {
      provider: this.name,
      providerRef: input.idempotencyKey,
      checkoutUrl: null,
      devPayment: true,
    };
  }

  verifyWebhook(rawBody: string, signature: string | null): VerifiedPaymentEvent | null {
    if (!signature) return null;
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest();
    let received: Buffer;
    try {
      received = Buffer.from(signature, 'hex');
    } catch (error) {
      if (error instanceof TypeError) return null;
      throw error;
    }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;

    const event = parsed as Record<string, unknown>;
    if (
      typeof event.providerRef !== 'string' ||
      typeof event.ticketId !== 'string' ||
      typeof event.amountEtb !== 'number' ||
      !Number.isFinite(event.amountEtb) ||
      (event.status !== 'paid' && event.status !== 'failed')
    ) {
      return null;
    }

    return {
      providerRef: event.providerRef,
      ticketId: event.ticketId,
      amountEtb: event.amountEtb,
      status: event.status,
    };
  }
}

export function createPaymentProvider(config: {
  provider: string;
  appEnv: string;
  nodeEnv: string;
  webhookSecret: string;
}): PaymentProvider {
  if (config.provider === 'disabled') return new DisabledPaymentProvider();
  if (config.provider === 'dev') {
    if (config.appEnv === 'development' && config.nodeEnv !== 'production') {
      return new DevelopmentPaymentProvider(config.webhookSecret);
    }
    throw new PaymentsNotConfiguredError();
  }
  throw new PaymentsNotConfiguredError();
}

export function signDevelopmentPaymentEvent(event: VerifiedPaymentEvent, secret: string): {
  body: string;
  signature: string;
} {
  if (!secret) throw new PaymentsNotConfiguredError();
  const body = JSON.stringify(event);
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  return { body, signature };
}