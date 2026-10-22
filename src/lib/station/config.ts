import { env } from '@/lib/config/env';
import {
  createPaymentProvider,
  type PaymentProvider,
} from '@/lib/station/payment-provider';
import { parseQrSigningKeys } from '@/lib/station/qr';

export function getQrSigningKeys(): {
  keys: Record<string, string>;
  currentKeyId: string;
} {
  const keys = parseQrSigningKeys(
    env.qrSigningKeyId,
    env.qrSigningSecret,
    env.qrSigningPreviousKeys,
  );
  const currentKeyId = env.qrSigningKeyId;
  if (!currentKeyId || !keys[currentKeyId]) {
    throw new Error('QR signing configuration is incomplete');
  }
  return { keys, currentKeyId };
}

export function getPaymentProvider(): PaymentProvider {
  return createPaymentProvider({
    provider: env.paymentProvider,
    appEnv: env.appEnv,
    webhookSecret: env.paymentWebhookSecret,
  });
}
